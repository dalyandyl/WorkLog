// 数据访问：只读共享 Electron 版的 %APPDATA%\WorkLog\logs 数据。
// 骨架阶段不回写，避免与 Electron 版产生写冲突；写路径后续迭代再开。
using System.IO;
using System.Text.Json;
using WorkLog_WinUI.Models;

namespace WorkLog_WinUI.Services;

public class DataStore
{
    public static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    /// <summary>数据根目录：与 Electron 打包版一致（%APPDATA%\WorkLog\logs）</summary>
    public string Root { get; }

    public DataStore()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        Root = Path.Combine(appData, "WorkLog", "logs");
    }

    private static string DayFilePath(string root, string date) =>
        Path.Combine(root, date[..4], $"{date}.json");

    /// <summary>读取某日任务（不存在返回空列表，与 Electron readTasks 行为一致）</summary>
    public List<TaskItem> ReadTasks(string date)
    {
        try
        {
            var file = DayFilePath(Root, date);
            if (!File.Exists(file)) return new();
            var day = JsonSerializer.Deserialize<DayFile>(File.ReadAllText(file), JsonOpts);
            var tasks = day?.Tasks ?? new();
            // 排序：未完成在前，同组内按 order（对齐 sortTasks）
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

    /// <summary>读取全局标签库（tags.json）</summary>
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

    /// <summary>读取设置（settings.json，可缺失）</summary>
    public AppSettingsMirror ReadSettings()
    {
        try
        {
            var file = Path.Combine(Root, "settings.json");
            if (!File.Exists(file)) return new();
            return JsonSerializer.Deserialize<AppSettingsMirror>(File.ReadAllText(file), JsonOpts) ?? new();
        }
        catch
        {
            return new();
        }
    }
}
