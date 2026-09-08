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

/// <summary>回收站条目（trash.json 的 items[]，对齐 shared/types.ts）</summary>
public class TrashedTask
{
    [JsonPropertyName("date")] public string Date { get; set; } = "";
    [JsonPropertyName("task")] public TaskItem Task { get; set; } = new();
}

public class TrashItem
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("deletedAt")] public string DeletedAt { get; set; } = "";
    [JsonPropertyName("tasks")] public List<TrashedTask> Tasks { get; set; } = new();
}

public class TrashFile
{
    [JsonPropertyName("items")] public List<TrashItem> Items { get; set; } = new();
}

/// <summary>发布记录（publish-history.json 的 records[]，对齐 shared/types.ts）</summary>
public class PublishInstance
{
    [JsonPropertyName("date")] public string Date { get; set; } = "";
    [JsonPropertyName("taskId")] public string TaskId { get; set; } = "";
}

public class PublishRecord
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("title")] public string Title { get; set; } = "";
    [JsonPropertyName("tags")] public List<string> Tags { get; set; } = new();
    [JsonPropertyName("dates")] public List<string> Dates { get; set; } = new();
    [JsonPropertyName("body")] public string Body { get; set; } = "";
    [JsonPropertyName("subtasks")] public List<Subtask> Subtasks { get; set; } = new();
    [JsonPropertyName("publishedAt")] public string PublishedAt { get; set; } = "";
    [JsonPropertyName("instances")] public List<PublishInstance> Instances { get; set; } = new();
}

public class PublishHistoryFile
{
    [JsonPropertyName("records")] public List<PublishRecord> Records { get; set; } = new();
}
