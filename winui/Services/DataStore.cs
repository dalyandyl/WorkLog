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

    /// <summary>新建任务（当天）</summary>
    public TaskItem CreateTask(string date, string title)
    {
        var tasks = ReadTasks(date);
        var now = IsoNow();
        var task = new TaskItem
        {
            Id = Guid.NewGuid().ToString(),
            Title = title.Trim(),
            Done = false,
            PublishedAt = now,
            CompletedAt = null,
            Order = tasks.Select(t => t.Order).DefaultIfEmpty(-1).Max() + 1,
            CreatedAt = now,
            UpdatedAt = now
        };
        tasks.Add(task);
        WriteTasks(Root, date, tasks);
        return task;
    }

    /// <summary>JS toISOString 等价格式（UTC）</summary>
    private static string IsoNow() =>
        DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fff") + "Z";

    /// <summary>删除任务（从所有包含该 id 的日期移除，对齐 deleteTask）</summary>
    public bool DeleteTask(string date, string taskId)
    {
        var found = false;
        foreach (var d in DatesOfTask(taskId))
        {
            var tasks = ReadTasks(d);
            var next = tasks.Where(t => t.Id != taskId).ToList();
            if (next.Count != tasks.Count)
            {
                found = true;
                WriteTasks(Root, d, next);
            }
        }
        return found;
    }
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
