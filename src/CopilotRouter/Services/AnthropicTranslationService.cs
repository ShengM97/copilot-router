using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotRouter.Services;

/// <summary>
/// Service for translating between Anthropic and OpenAI API formats
/// </summary>
public class AnthropicTranslationService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    #region Payload Translation (Anthropic -> OpenAI)

    /// <summary>
    /// Translate Anthropic Messages payload to OpenAI Chat Completions payload
    /// </summary>
    public ChatCompletionsPayload TranslateToOpenAI(AnthropicMessagesPayload payload)
    {
        return new ChatCompletionsPayload
        {
            Model = TranslateModelName(payload.Model),
            Messages = TranslateAnthropicMessagesToOpenAI(payload.Messages, payload.System),
            MaxTokens = payload.MaxTokens,
            Stop = payload.StopSequences,
            Stream = payload.Stream,
            Temperature = payload.Temperature,
            TopP = payload.TopP,
            User = payload.Metadata?.UserId,
            Tools = TranslateAnthropicToolsToOpenAI(payload.Tools),
            ToolChoice = TranslateAnthropicToolChoiceToOpenAI(payload.ToolChoice)
        };
    }

    private static string TranslateModelName(string model)
    {
        if (model.StartsWith("claude-sonnet-4-"))
            return "claude-sonnet-4";
        if (model.StartsWith("claude-opus-4-"))
            return "claude-opus-4";
        return model;
    }

    private List<Message> TranslateAnthropicMessagesToOpenAI(
        List<AnthropicMessage> anthropicMessages,
        object? system)
    {
        var messages = new List<Message>();

        // Handle system prompt
        messages.AddRange(HandleSystemPrompt(system));

        // Handle other messages
        foreach (var message in anthropicMessages)
        {
            if (message.Role == "user")
                messages.AddRange(HandleUserMessage(message));
            else
                messages.AddRange(HandleAssistantMessage(message));
        }

        return messages;
    }

    /// <summary>
    /// Extract content from tool_result block, handling both string and array formats
    /// </summary>
    private static string ExtractToolResultContent(JsonElement block)
    {
        if (!block.TryGetProperty("content", out var contentProp))
            return "";

        // Handle string content
        if (contentProp.ValueKind == JsonValueKind.String)
            return contentProp.GetString() ?? "";

        // Handle array content: [{"type": "text", "text": "..."}, ...]
        if (contentProp.ValueKind == JsonValueKind.Array)
        {
            var texts = new List<string>();
            foreach (var item in contentProp.EnumerateArray())
            {
                if (item.TryGetProperty("type", out var typeProp) && 
                    typeProp.GetString() == "text" &&
                    item.TryGetProperty("text", out var textProp))
                {
                    texts.Add(textProp.GetString() ?? "");
                }
            }
            return string.Join("\n", texts);
        }

        return "";
    }

    private static List<Message> HandleSystemPrompt(object? system)
    {
        if (system == null) return [];

        if (system is string systemStr)
        {
            return [new Message { Role = "system", Content = systemStr }];
        }

        if (system is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.String)
            {
                return [new Message { Role = "system", Content = element.GetString() }];
            }

            if (element.ValueKind == JsonValueKind.Array)
            {
                var texts = new List<string>();
                foreach (var block in element.EnumerateArray())
                {
                    if (block.TryGetProperty("text", out var textProp))
                    {
                        texts.Add(textProp.GetString() ?? "");
                    }
                }
                return [new Message { Role = "system", Content = string.Join("\n\n", texts) }];
            }
        }

        return [];
    }

    private List<Message> HandleUserMessage(AnthropicMessage message)
    {
        var messages = new List<Message>();

        // Handle string content (may come as string or JsonElement)
        if (message.Content is string contentStr)
        {
            messages.Add(new Message { Role = "user", Content = contentStr });
            return messages;
        }

        if (message.Content is JsonElement element)
        {
            // Handle string as JsonElement
            if (element.ValueKind == JsonValueKind.String)
            {
                messages.Add(new Message { Role = "user", Content = element.GetString() });
                return messages;
            }

            // Handle array content
            if (element.ValueKind == JsonValueKind.Array)
            {
                var toolResults = new List<JsonElement>();
                var otherBlocks = new List<JsonElement>();

                foreach (var block in element.EnumerateArray())
                {
                    var type = block.GetProperty("type").GetString();
                    if (type == "tool_result")
                        toolResults.Add(block);
                    else
                        otherBlocks.Add(block);
                }

                // Tool results must come first
                foreach (var block in toolResults)
                {
                    var toolUseId = block.GetProperty("tool_use_id").GetString() ?? "";
                    var content = ExtractToolResultContent(block);
                    
                    messages.Add(new Message
                    {
                        Role = "tool",
                        ToolCallId = toolUseId,
                        Content = content
                    });
                }

                if (otherBlocks.Count > 0)
                {
                    messages.Add(new Message
                    {
                        Role = "user",
                        Content = MapContent(otherBlocks)
                    });
                }
            }
        }

        return messages;
    }

    private List<Message> HandleAssistantMessage(AnthropicMessage message)
    {
        if (message.Content is string contentStr)
        {
            return [new Message { Role = "assistant", Content = contentStr }];
        }

        if (message.Content is JsonElement element)
        {
            // Handle string as JsonElement
            if (element.ValueKind == JsonValueKind.String)
            {
                return [new Message { Role = "assistant", Content = element.GetString() }];
            }

            // Handle array content
            if (element.ValueKind == JsonValueKind.Array)
            {
                var toolUseBlocks = new List<JsonElement>();
                var textParts = new List<string>();

                foreach (var block in element.EnumerateArray())
                {
                    var type = block.GetProperty("type").GetString();
                    switch (type)
                    {
                        case "tool_use":
                            toolUseBlocks.Add(block);
                            break;
                        case "text":
                            textParts.Add(block.GetProperty("text").GetString() ?? "");
                            break;
                        case "thinking":
                            textParts.Add(block.GetProperty("thinking").GetString() ?? "");
                            break;
                    }
                }

                var textContent = string.Join("\n\n", textParts);

                if (toolUseBlocks.Count > 0)
                {
                    var toolCalls = toolUseBlocks.Select(tc => new ToolCall
                    {
                        Id = tc.GetProperty("id").GetString() ?? "",
                        Type = "function",
                        Function = new FunctionCall
                        {
                            Name = tc.GetProperty("name").GetString() ?? "",
                            Arguments = tc.GetProperty("input").GetRawText()
                        }
                    }).ToList();

                    return [new Message
                    {
                        Role = "assistant",
                        Content = string.IsNullOrEmpty(textContent) ? null : textContent,
                        ToolCalls = toolCalls
                    }];
                }

                return [new Message { Role = "assistant", Content = textContent }];
            }
        }

        return [new Message { Role = "assistant", Content = null }];
    }

    private static object? MapContent(List<JsonElement> blocks)
    {
        var hasImage = blocks.Any(b => b.GetProperty("type").GetString() == "image");

        if (!hasImage)
        {
            var texts = new List<string>();
            foreach (var block in blocks)
            {
                var type = block.GetProperty("type").GetString();
                if (type == "text")
                    texts.Add(block.GetProperty("text").GetString() ?? "");
                else if (type == "thinking")
                    texts.Add(block.GetProperty("thinking").GetString() ?? "");
            }
            return string.Join("\n\n", texts);
        }

        var parts = new List<ContentPart>();
        foreach (var block in blocks)
        {
            var type = block.GetProperty("type").GetString();
            switch (type)
            {
                case "text":
                    parts.Add(new ContentPart 
                    { 
                        Type = "text", 
                        Text = block.GetProperty("text").GetString() 
                    });
                    break;
                case "image":
                    var source = block.GetProperty("source");
                    var mediaType = source.GetProperty("media_type").GetString();
                    var data = source.GetProperty("data").GetString();
                    parts.Add(new ContentPart
                    {
                        Type = "image_url",
                        ImageUrl = new ImageUrl { Url = $"data:{mediaType};base64,{data}" }
                    });
                    break;
            }
        }
        return parts;
    }

    private static List<Tool>? TranslateAnthropicToolsToOpenAI(List<AnthropicTool>? tools)
    {
        return tools?.Select(t => new Tool
        {
            Type = "function",
            Function = new ToolFunction
            {
                Name = t.Name,
                Description = t.Description,
                Parameters = t.InputSchema
            }
        }).ToList();
    }

    private static object? TranslateAnthropicToolChoiceToOpenAI(AnthropicToolChoice? toolChoice)
    {
        if (toolChoice == null) return null;

        return toolChoice.Type switch
        {
            "auto" => "auto",
            "any" => "required",
            "none" => "none",
            "tool" when !string.IsNullOrEmpty(toolChoice.Name) => new
            {
                type = "function",
                function = new { name = toolChoice.Name }
            },
            _ => null
        };
    }

    #endregion

    #region Response Translation (OpenAI -> Anthropic)

    /// <summary>
    /// Translate OpenAI Chat Completion response to Anthropic Messages response
    /// </summary>
    public AnthropicResponse TranslateToAnthropic(ChatCompletionResponse response)
    {
        var allTextBlocks = new List<AnthropicContentBlock>();
        var allToolUseBlocks = new List<AnthropicContentBlock>();
        string? stopReason = null;

        foreach (var choice in response.Choices)
        {
            stopReason ??= choice.FinishReason;

            if (!string.IsNullOrEmpty(choice.Message.Content))
            {
                allTextBlocks.Add(new AnthropicContentBlock
                {
                    Type = "text",
                    Text = choice.Message.Content
                });
            }

            if (choice.Message.ToolCalls != null)
            {
                foreach (var tc in choice.Message.ToolCalls)
                {
                    allToolUseBlocks.Add(new AnthropicContentBlock
                    {
                        Type = "tool_use",
                        Id = tc.Id,
                        Name = tc.Function.Name,
                        Input = JsonSerializer.Deserialize<Dictionary<string, object>>(tc.Function.Arguments, JsonOptions)
                    });
                }

                if (choice.FinishReason == "tool_calls")
                    stopReason = "tool_calls";
            }
        }

        var cachedTokens = response.Usage?.PromptTokensDetails?.CachedTokens ?? 0;

        return new AnthropicResponse
        {
            Id = response.Id,
            Type = "message",
            Role = "assistant",
            Model = response.Model,
            Content = [..allTextBlocks, ..allToolUseBlocks],
            StopReason = MapStopReason(stopReason),
            StopSequence = null,
            Usage = new AnthropicUsage
            {
                InputTokens = (response.Usage?.PromptTokens ?? 0) - cachedTokens,
                OutputTokens = response.Usage?.CompletionTokens ?? 0,
                CacheReadInputTokens = cachedTokens > 0 ? cachedTokens : null
            }
        };
    }

    /// <summary>
    /// Translate streaming chunk to Anthropic events
    /// </summary>
    public List<AnthropicStreamEvent> TranslateChunkToAnthropicEvents(
        ChatCompletionChunk chunk,
        AnthropicStreamState state)
    {
        var events = new List<AnthropicStreamEvent>();

        if (chunk.Choices.Count == 0)
            return events;

        var choice = chunk.Choices[0];
        var delta = choice.Delta;

        // Message start
        if (!state.MessageStartSent)
        {
            var cachedTokens = chunk.Usage?.PromptTokensDetails?.CachedTokens ?? 0;
            events.Add(new AnthropicStreamEvent
            {
                Type = "message_start",
                Message = new AnthropicMessageStart
                {
                    Id = chunk.Id,
                    Type = "message",
                    Role = "assistant",
                    Content = [],
                    Model = chunk.Model,
                    StopReason = null,
                    StopSequence = null,
                    Usage = new AnthropicUsage
                    {
                        InputTokens = (chunk.Usage?.PromptTokens ?? 0) - cachedTokens,
                        OutputTokens = 0,
                        CacheReadInputTokens = cachedTokens > 0 ? cachedTokens : null
                    }
                }
            });
            state.MessageStartSent = true;
        }

        // Text content
        if (!string.IsNullOrEmpty(delta?.Content))
        {
            if (IsToolBlockOpen(state))
            {
                events.Add(new AnthropicStreamEvent
                {
                    Type = "content_block_stop",
                    Index = state.ContentBlockIndex
                });
                state.ContentBlockIndex++;
                state.ContentBlockOpen = false;
            }

            if (!state.ContentBlockOpen)
            {
                events.Add(new AnthropicStreamEvent
                {
                    Type = "content_block_start",
                    Index = state.ContentBlockIndex,
                    ContentBlock = new AnthropicContentBlock { Type = "text", Text = "" }
                });
                state.ContentBlockOpen = true;
            }

            events.Add(new AnthropicStreamEvent
            {
                Type = "content_block_delta",
                Index = state.ContentBlockIndex,
                Delta = new AnthropicDelta { Type = "text_delta", Text = delta.Content }
            });
        }

        // Tool calls
        if (delta?.ToolCalls != null)
        {
            foreach (var toolCall in delta.ToolCalls)
            {
                if (!string.IsNullOrEmpty(toolCall.Id) && !string.IsNullOrEmpty(toolCall.Function?.Name))
                {
                    if (state.ContentBlockOpen)
                    {
                        events.Add(new AnthropicStreamEvent
                        {
                            Type = "content_block_stop",
                            Index = state.ContentBlockIndex
                        });
                        state.ContentBlockIndex++;
                        state.ContentBlockOpen = false;
                    }

                    var blockIndex = state.ContentBlockIndex;
                    state.ToolCalls[toolCall.Index] = new ToolCallInfo
                    {
                        Id = toolCall.Id,
                        Name = toolCall.Function.Name,
                        AnthropicBlockIndex = blockIndex
                    };

                    events.Add(new AnthropicStreamEvent
                    {
                        Type = "content_block_start",
                        Index = blockIndex,
                        ContentBlock = new AnthropicContentBlock
                        {
                            Type = "tool_use",
                            Id = toolCall.Id,
                            Name = toolCall.Function.Name,
                            Input = new Dictionary<string, object>()
                        }
                    });
                    state.ContentBlockOpen = true;
                }

                if (!string.IsNullOrEmpty(toolCall.Function?.Arguments))
                {
                    if (state.ToolCalls.TryGetValue(toolCall.Index, out var tcInfo))
                    {
                        events.Add(new AnthropicStreamEvent
                        {
                            Type = "content_block_delta",
                            Index = tcInfo.AnthropicBlockIndex,
                            Delta = new AnthropicDelta
                            {
                                Type = "input_json_delta",
                                PartialJson = toolCall.Function.Arguments
                            }
                        });
                    }
                }
            }
        }

        // Finish
        if (!string.IsNullOrEmpty(choice.FinishReason))
        {
            if (state.ContentBlockOpen)
            {
                events.Add(new AnthropicStreamEvent
                {
                    Type = "content_block_stop",
                    Index = state.ContentBlockIndex
                });
                state.ContentBlockOpen = false;
            }

            var cachedTokens = chunk.Usage?.PromptTokensDetails?.CachedTokens ?? 0;
            events.Add(new AnthropicStreamEvent
            {
                Type = "message_delta",
                Delta = new AnthropicDelta
                {
                    StopReason = MapStopReason(choice.FinishReason),
                    StopSequence = null
                },
                Usage = new AnthropicUsage
                {
                    InputTokens = (chunk.Usage?.PromptTokens ?? 0) - cachedTokens,
                    OutputTokens = chunk.Usage?.CompletionTokens ?? 0,
                    CacheReadInputTokens = cachedTokens > 0 ? cachedTokens : null
                }
            });

            events.Add(new AnthropicStreamEvent { Type = "message_stop" });
        }

        return events;
    }

    private static bool IsToolBlockOpen(AnthropicStreamState state)
    {
        if (!state.ContentBlockOpen) return false;
        return state.ToolCalls.Values.Any(tc => tc.AnthropicBlockIndex == state.ContentBlockIndex);
    }

    private static string? MapStopReason(string? finishReason)
    {
        return finishReason switch
        {
            "stop" => "end_turn",
            "length" => "max_tokens",
            "tool_calls" => "tool_use",
            "content_filter" => "end_turn",
            _ => null
        };
    }

    #endregion
}

#region Anthropic Types

public class AnthropicMessagesPayload
{
    [JsonPropertyName("model")]
    public required string Model { get; set; }

    [JsonPropertyName("messages")]
    public List<AnthropicMessage> Messages { get; set; } = [];

    [JsonPropertyName("max_tokens")]
    public int MaxTokens { get; set; }

    [JsonPropertyName("system")]
    public object? System { get; set; }

    [JsonPropertyName("metadata")]
    public AnthropicMetadata? Metadata { get; set; }

    [JsonPropertyName("stop_sequences")]
    public List<string>? StopSequences { get; set; }

    [JsonPropertyName("stream")]
    public bool? Stream { get; set; }

    [JsonPropertyName("temperature")]
    public double? Temperature { get; set; }

    [JsonPropertyName("top_p")]
    public double? TopP { get; set; }

    [JsonPropertyName("top_k")]
    public int? TopK { get; set; }

    [JsonPropertyName("tools")]
    public List<AnthropicTool>? Tools { get; set; }

    [JsonPropertyName("tool_choice")]
    public AnthropicToolChoice? ToolChoice { get; set; }
}

public class AnthropicMessage
{
    [JsonPropertyName("role")]
    public required string Role { get; set; }

    [JsonPropertyName("content")]
    public object? Content { get; set; }
}

public class AnthropicMetadata
{
    [JsonPropertyName("user_id")]
    public string? UserId { get; set; }
}

public class AnthropicTool
{
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("input_schema")]
    public Dictionary<string, object>? InputSchema { get; set; }
}

public class AnthropicToolChoice
{
    [JsonPropertyName("type")]
    public required string Type { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

public class AnthropicResponse
{
    [JsonPropertyName("id")]
    public required string Id { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "message";

    [JsonPropertyName("role")]
    public string Role { get; set; } = "assistant";

    [JsonPropertyName("model")]
    public required string Model { get; set; }

    [JsonPropertyName("content")]
    public List<AnthropicContentBlock> Content { get; set; } = [];

    [JsonPropertyName("stop_reason")]
    public string? StopReason { get; set; }

    [JsonPropertyName("stop_sequence")]
    public string? StopSequence { get; set; }

    [JsonPropertyName("usage")]
    public AnthropicUsage Usage { get; set; } = new();
}

public class AnthropicContentBlock
{
    [JsonPropertyName("type")]
    public required string Type { get; set; }

    [JsonPropertyName("text")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Text { get; set; }

    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Id { get; set; }

    [JsonPropertyName("name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Name { get; set; }

    [JsonPropertyName("input")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public object? Input { get; set; }
}

public class AnthropicUsage
{
    [JsonPropertyName("input_tokens")]
    public int InputTokens { get; set; }

    [JsonPropertyName("output_tokens")]
    public int OutputTokens { get; set; }

    [JsonPropertyName("cache_creation_input_tokens")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? CacheCreationInputTokens { get; set; }

    [JsonPropertyName("cache_read_input_tokens")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? CacheReadInputTokens { get; set; }
}

// Stream types
public class AnthropicStreamEvent
{
    [JsonPropertyName("type")]
    public required string Type { get; set; }

    [JsonPropertyName("message")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AnthropicMessageStart? Message { get; set; }

    [JsonPropertyName("index")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public int Index { get; set; }

    [JsonPropertyName("content_block")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AnthropicContentBlock? ContentBlock { get; set; }

    [JsonPropertyName("delta")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AnthropicDelta? Delta { get; set; }

    [JsonPropertyName("usage")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public AnthropicUsage? Usage { get; set; }
}

public class AnthropicMessageStart
{
    [JsonPropertyName("id")]
    public required string Id { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "message";

    [JsonPropertyName("role")]
    public string Role { get; set; } = "assistant";

    [JsonPropertyName("content")]
    public List<object> Content { get; set; } = [];

    [JsonPropertyName("model")]
    public required string Model { get; set; }

    [JsonPropertyName("stop_reason")]
    public string? StopReason { get; set; }

    [JsonPropertyName("stop_sequence")]
    public string? StopSequence { get; set; }

    [JsonPropertyName("usage")]
    public AnthropicUsage Usage { get; set; } = new();
}

public class AnthropicDelta
{
    [JsonPropertyName("type")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Type { get; set; }

    [JsonPropertyName("text")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Text { get; set; }

    [JsonPropertyName("partial_json")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PartialJson { get; set; }

    [JsonPropertyName("stop_reason")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StopReason { get; set; }

    [JsonPropertyName("stop_sequence")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StopSequence { get; set; }
}

public class AnthropicStreamState
{
    public bool MessageStartSent { get; set; }
    public int ContentBlockIndex { get; set; }
    public bool ContentBlockOpen { get; set; }
    public Dictionary<int, ToolCallInfo> ToolCalls { get; set; } = new();
}

public class ToolCallInfo
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public int AnthropicBlockIndex { get; set; }
}

#endregion
