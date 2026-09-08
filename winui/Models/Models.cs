// 数据模型：与 Electron 版 src/shared/types.ts 保持字段级对齐，
// 两个版本读写同一份 %APPDATA%\WorkLog JSON 数据。
using System.Text.Json.Serialization;

namespace WorkLog_WinUI.Models;

/// <summary>子任务（仅标题，可勾选、带标签）</summary>
public class Subtask
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("done")] public bool Done { get; set; }
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = new();
}

/// <summary>任务（日报条目）</summary>
public class TaskItem
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = new();
    [JsonPropertyName("done")] public bool Done { get; set; }
    [JsonPropertyName("body")] public string Body { get; set; } = "";
    [JsonPropertyName("subtasks")] public List<Subtask> Subtasks { get; set; } = new();
    [JsonPropertyName("note")] public string Note { get; set; } = "";
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; set; } = "";
    [JsonPropertyName("completedAt")] public string? CompletedAt { get; set; }
    [JsonPropertyName("order")] public int Order { get; set; }
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
    [JsonPropertyName("updatedAt")] public string UpdatedAt { get; set; } = "";

    /// <summary>完成度（子任务视角，无子任务时按整体完成态 0/1）</summary>
    [JsonIgnore]
    public double Progress => Subtasks.Count > 0
        ? (double)Subtasks.Count(s => s.Done) / Subtasks.Count
        : (Done ? 1 : 0);
}

/// <summary>标签（全局标签库，tags.json）</summary>
public class TagInfo
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("color")] public string Color { get; set; } = "#3b82f6";
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
}

/// <summary>单日文件（&lt;年份&gt;/YYYY-MM-DD.json）</summary>
public class DayFile
{
    [JsonPropertyName("tasks")] public List<TaskItem> Tasks { get; set; } = new();
}

/// <summary>设置（settings.json，仅镜像 WinUI 版用到的字段）</summary>
public class AppSettingsMirror
{
    [JsonPropertyName("theme")] public string Theme { get; set; } = "system";
    [JsonPropertyName("accent")] public string Accent { get; set; } = "blue";
}
