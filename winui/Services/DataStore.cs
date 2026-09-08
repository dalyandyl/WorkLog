// 数据访问：与 Electron 版共用同一份 JSON 数据。
// 数据源：正式版 %APPDATA%\WorkLog\logs；开发版 <仓库>/logs（dev 模式）。
// 写回语义对齐 src/main/tasks.ts：区间任务同 id 多天同步、勾选记完成时间、
// 空任务列表删除当天文件。
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using WorkLog_WinUI.Models;

namespace WorkLog_WinUI.Services;

public class DataStore
{
    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        WriteIndented = true
    };

    /// <summary>正式版数据根目录（Electron 打包版）</summary>
    public static string AppDataRoot { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkLog", "logs");

    /// <summary>
    /// 开发版数据根目录：从应用目录向上找含 package.json 的仓库根，
    /// 其 logs/ 即 Electron dev 模式的数据目录。找不到返回 null。
    /// </summary>
    public static string? DetectDevRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "package.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "logs")))
                return Path.Combine(dir.FullName, "logs");
            dir = dir.Parent;
        }
        return null;
    }

    /// <summary>当前生效的数据根目录（可切换，切换后由页面重新加载）</summary>
    public string Root { get; private set; }

    public DataStore()
    {
        var saved = SettingsPersistence.Read()?.DataDir;
        Root = saved switch
        {
            "appdata" => AppDataRoot,
            "dev" => DetectDevRoot() ?? AppDataRoot,
            _ => DetectDevRoot() ?? AppDataRoot // auto：优先 dev（并行开发期数据在 dev 目录）
        };
    }

    /// <summary>切换数据源（设置页调用）</summary>
    public void SwitchRoot(string mode)
    {
        Root = mode switch
        {
            "appdata" => AppDataRoot,
            "dev" => DetectDevRoot() ?? AppDataRoot,
            _ => DetectDevRoot() ?? AppDataRoot
        };
        SettingsPersistence.Mutate(s => s.DataDir = mode);
    }

    /// <summary>当前是否指向 dev 目录</summary>
    public bool IsDevRoot => string.Equals(Root, DetectDevRoot(), StringComparison.OrdinalIgnoreCase);

    // ---------------- 读 ----------------

    private static string DayFilePath(string root, string date) =>
        Path.Combine(root, date[..4], $"{date}.json");

    /// <summary>读取某日任务（不存在返回空列表，对齐 readTasks 兼容逻辑）</summary>
    public List<TaskItem> ReadTasks(string date)
    {
        try
        {
            var file = DayFilePath(Root, date);
            if (!File.Exists(file)) return new();
            var day = JsonSerializer.Deserialize<DayFile>(File.ReadAllText(file), JsonOpts);
            var tasks = day?.Tasks ?? new();
            return tasks.OrderBy(t => t.Done).ThenBy(t => t.Order).ToList();
        }
        catch
        {
            return new();
        }
    }

    /// <summary>扫描所有有任务的日期（升序，对齐 listDatesWithTasks）</summary>
    public List<string> ListDatesWithTasks()
    {
        var dates = new List<string>();
        try
        {
            foreach (var yearDir in Directory.EnumerateDirectories(Root))
            {
                foreach (var f in Directory.EnumerateFiles(yearDir, "*.json"))
                {
                    var name = Path.GetFileName(f);
                    if (name.Length == 15 && DateTime.TryParse(name[..10], out _))
                        dates.Add(name[..10]);
                }
            }
        }
        catch (DirectoryNotFoundException) { }
        dates.Sort();
        return dates;
    }

    public List<TagInfo> ReadTags()
    {
        try
        {
            var file = Path.Combine(Root, "tags.json");
            if (!File.Exists(file)) return new();
            return JsonSerializer.Deserialize<List<TagInfo>>(File.ReadAllText(file), JsonOpts) ?? new();
        }
        catch
        {
            return new();
        }
    }

    // ---------------- 写（语义对齐 Electron src/main/tasks.ts） ----------------

    private static void WriteTasks(string root, string date, List<TaskItem> tasks)
    {
        var file = DayFilePath(root, date);
        if (tasks.Count == 0)
        {
            File.Delete(file);
            return;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, JsonSerializer.Serialize(new DayFile { Tasks = tasks }, JsonOpts));
    }

    /// <summary>找出所有包含指定任务 id 的日期（区间共享任务会出现在多天）</summary>
    private List<string> DatesOfTask(string taskId)
    {
        var result = new List<string>();
        foreach (var d in ListDatesWithTasks())
            if (ReadTasks(d).Any(t => t.Id == taskId))
                result.Add(d);
        return result;
    }

    /// <summary>勾选/取消完成：更新所有共享该 id 的日期，勾选时记完成时间</summary>
    public void SetTaskDone(string date, string taskId, bool done)
    {
        var tasks = ReadTasks(date);
        var task = tasks.FirstOrDefault(t => t.Id == taskId);
        if (task is null) return;

        task.Done = done;
        task.CompletedAt = done ? IsoNow() : null;
        task.UpdatedAt = IsoNow();

        foreach (var d in DatesOfTask(taskId))
        {
            var dayTasks = ReadTasks(d);
            var idx = dayTasks.FindIndex(t => t.Id == taskId);
            if (idx != -1)
            {
                var localOrder = dayTasks[idx].Order; // 保留各天原有 order
                dayTasks[idx] = task;
                dayTasks[idx].Order = localOrder;
                WriteTasks(Root, d, dayTasks);
            }
        }
    }

    /// <summary>新建任务（当天，完整字段）</summary>
    public TaskItem CreateTaskFull(string date, string title, string body, string note, List<Subtask> subtasks)
    {
        var tasks = ReadTasks(date);
        var task = MakeTask(title, tasks);
        task.Body = body;
        task.Note = note;
        task.Subtasks = subtasks;
        tasks.Add(task);
        WriteTasks(Root, date, tasks);
        return task;
    }

    /// <summary>新建任务（仅标题）</summary>
    public TaskItem CreateTask(string date, string title) => CreateTaskFull(date, title, "", "", new());

    /// <summary>编辑任务：多天同步（对齐 updateTask：共享 id 的所有日期更新，保留各天 order）</summary>
    public bool UpdateTask(string date, string taskId, Action<TaskItem> patch)
    {
        var tasks = ReadTasks(date);
        var task = tasks.FirstOrDefault(t => t.Id == taskId);
        if (task is null) return false;

        patch(task);
        task.UpdatedAt = IsoNow();

        foreach (var d in DatesOfTask(taskId))
        {
            var dayTasks = ReadTasks(d);
            var idx = dayTasks.FindIndex(t => t.Id == taskId);
            if (idx != -1)
            {
                var localOrder = dayTasks[idx].Order;
                dayTasks[idx] = task;
                dayTasks[idx].Order = localOrder;
                WriteTasks(Root, d, dayTasks);
            }
        }
        return true;
    }

    /// <summary>任务发布：区间派发，同一任务 id 写入所选每个日期（对齐 publishTasks），并写发布历史</summary>
    public int PublishTasks(List<string> dates, string title, string body, List<Subtask> subtasks)
    {
        var now = IsoNow();
        var task = new TaskItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = title.Trim(),
            Done = false,
            Body = body,
            Subtasks = subtasks,
            PublishedAt = now,
            Order = 0,
            CreatedAt = now,
            UpdatedAt = now
        };

        var instances = new List<PublishInstance>();
        foreach (var d in dates)
        {
            var tasks = ReadTasks(d);
            task.Order = tasks.Select(t => t.Order).DefaultIfEmpty(-1).Max() + 1;
            tasks.Add(task);
            WriteTasks(Root, d, tasks);
            instances.Add(new PublishInstance { Date = d, TaskId = task.Id });
        }

        // 发布历史（对齐主进程 publish 处理器：publishTasks + addPublishRecord）
        AddPublishRecord(new PublishRecord
        {
            Id = Guid.NewGuid().ToString(),
            Title = task.Title,
            Dates = dates,
            Body = body,
            Subtasks = subtasks,
            PublishedAt = now,
            Instances = instances
        });
        return dates.Count;
    }

    // ---------------- 休息日标记（rest.json，对齐 meta.ts） ----------------

    private string RestPath => Path.Combine(Root, "rest.json");

    private HashSet<string> ReadRestSet()
    {
        try
        {
            if (!File.Exists(RestPath)) return new();
            var doc = JsonNode.Parse(File.ReadAllText(RestPath));
            var set = new HashSet<string>();
            if (doc?["dates"] is JsonNode dates)
                foreach (var prop in dates.AsObject())
                    if (prop.Value?["rest"]?.GetValue<bool>() == true)
                        set.Add(prop.Key);
            return set;
        }
        catch
        {
            return new();
        }
    }

    public bool IsRest(string date) => ReadRestSet().Contains(date);

    public void SetRest(string date, bool rest)
    {
        var set = ReadRestSet();
        if (rest) set.Add(date); else set.Remove(date);
        var dates = new JsonObject();
        foreach (var d in set) dates[d] = new JsonObject { ["rest"] = true };
        Directory.CreateDirectory(Path.GetDirectoryName(RestPath)!);
        File.WriteAllText(RestPath, JsonSerializer.Serialize(new JsonObject { ["dates"] = dates }, JsonOpts));
    }

    // ---------------- 发布历史（publish-history.json） ----------------

    private string HistoryPath => Path.Combine(Root, "publish-history.json");

    /// <summary>发布记录列表（新记录在前，对齐 readPublishRecords + unshift 语义）</summary>
    public List<PublishRecord> ReadPublishRecords()
    {
        try
        {
            if (!File.Exists(HistoryPath)) return new();
            var f = JsonSerializer.Deserialize<PublishHistoryFile>(File.ReadAllText(HistoryPath), JsonOpts);
            return f?.Records ?? new();
        }
        catch
        {
            return new();
        }
    }

    private void AddPublishRecord(PublishRecord record)
    {
        var records = ReadPublishRecords();
        records.Insert(0, record);
        Directory.CreateDirectory(Path.GetDirectoryName(HistoryPath)!);
        File.WriteAllText(HistoryPath,
            JsonSerializer.Serialize(new PublishHistoryFile { Records = records }, JsonOpts));
    }

    /// <summary>删除发布记录（不影响已发布到各天的任务，对齐 deletePublishRecord）</summary>
    public bool RemovePublishRecord(string id)
    {
        var records = ReadPublishRecords();
        var next = records.Where(r => r.Id != id).ToList();
        if (next.Count == records.Count) return false;
        File.WriteAllText(HistoryPath,
            JsonSerializer.Serialize(new PublishHistoryFile { Records = next }, JsonOpts));
        return true;
    }

    private static TaskItem MakeTask(string title, List<TaskItem> existing)
    {
        var now = IsoNow();
        return new TaskItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = title.Trim(),
            Done = false,
            PublishedAt = now,
            CompletedAt = null,
            Order = existing.Select(t => t.Order).DefaultIfEmpty(-1).Max() + 1,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    /// <summary>JS toISOString 等价格式（UTC）</summary>
    private static string IsoNow() =>
        DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fff") + "Z";

    /// <summary>删除任务：从所有天移除并写入回收站（对齐 index.ts tasks:trash）</summary>
    public bool TrashTask(string date, string taskId)
    {
        var trashed = new List<TrashedTask>();
        foreach (var d in DatesOfTask(taskId))
        {
            var tasks = ReadTasks(d);
            var task = tasks.FirstOrDefault(t => t.Id == taskId);
            if (task is null) continue;
            trashed.Add(new TrashedTask { Date = d, Task = task });
            WriteTasks(Root, d, tasks.Where(t => t.Id != taskId).ToList());
        }
        if (trashed.Count == 0) return false;

        var items = ReadTrashRaw();
        items.Insert(0, new TrashItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = trashed[0].Task.Title.Length > 0 ? trashed[0].Task.Title : "未命名任务",
            DeletedAt = IsoNow(),
            Tasks = trashed
        });
        WriteTrash(items);
        return true;
    }

    // ---------------- 回收站（trash.json） ----------------

    private string TrashPath => Path.Combine(Root, "trash.json");

    private List<TrashItem> ReadTrashRaw()
    {
        try
        {
            if (!File.Exists(TrashPath)) return new();
            var f = JsonSerializer.Deserialize<TrashFile>(File.ReadAllText(TrashPath), JsonOpts);
            return f?.Items ?? new();
        }
        catch
        {
            return new();
        }
    }

    private void WriteTrash(List<TrashItem> items)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TrashPath)!);
        File.WriteAllText(TrashPath, JsonSerializer.Serialize(new TrashFile { Items = items }, JsonOpts));
    }

    /// <summary>回收站列表（删除时间倒序，对齐 listTrash）</summary>
    public List<TrashItem> ListTrash() =>
        ReadTrashRaw().OrderByDescending(i => i.DeletedAt).ToList();

    /// <summary>恢复条目：任务实例写回各自日期（对齐 restoreTasksToDays）</summary>
    public bool RestoreTrashItem(string id)
    {
        var items = ReadTrashRaw();
        var item = items.FirstOrDefault(i => i.Id == id);
        if (item is null) return false;

        foreach (var entry in item.Tasks)
        {
            var tasks = ReadTasks(entry.Date);
            // 若同 id 已存在（重复恢复/重派发）则跳过
            if (tasks.Any(t => t.Id == entry.Task.Id)) continue;
            entry.Task.Order = tasks.Select(t => t.Order).DefaultIfEmpty(-1).Max() + 1;
            tasks.Add(entry.Task);
            WriteTasks(Root, entry.Date, tasks);
        }
        WriteTrash(items.Where(i => i.Id != id).ToList());
        return true;
    }

    /// <summary>永久删除单条</summary>
    public bool RemoveTrashItem(string id)
    {
        var items = ReadTrashRaw();
        var next = items.Where(i => i.Id != id).ToList();
        if (next.Count == items.Count) return false;
        WriteTrash(next);
        return true;
    }

    /// <summary>清空回收站</summary>
    public void ClearTrash() => WriteTrash(new());
}

/// <summary>WinUI 版独立设置（winui-settings.json，不写 Electron 版设置）</summary>
public class SettingsPersistence
{
    public sealed class Persisted
    {
        public string Theme { get; set; } = "system";
        public string Backdrop { get; set; } = "mica";
        public string? DataDir { get; set; }
    }

    private static readonly string File = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "WorkLog", "winui-settings.json");

    private static Persisted? _cached;

    public static string Theme => Read().Theme;
    public static string Backdrop => Read().Backdrop;
    public static string? DataDir => Read().DataDir;

    public static Persisted Read()
    {
        if (_cached != null) return _cached;
        try
        {
            if (System.IO.File.Exists(File))
                return _cached = JsonSerializer.Deserialize<Persisted>(System.IO.File.ReadAllText(File)) ?? new();
        }
        catch { }
        return _cached = new();
    }

    public static void Mutate(Action<Persisted> change)
    {
        var s = Read();
        change(s);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(File)!);
            System.IO.File.WriteAllText(File, JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }
}
