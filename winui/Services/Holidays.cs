// 中国法定节假日与调休（对齐 src/renderer/src/utils/holidays.ts）：
// 内置 2025/2026 静态数据；其他年份按需从 timor.tech 官方接口在线拉取（带运行时缓存）。
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace WorkLog_WinUI.Services;

public enum HolidayKind { Holiday, AdjustedWork }

public record HolidayInfo(HolidayKind Kind, string Name);

public static class Holidays
{
    public sealed class YearData
    {
        public Dictionary<string, string> Holiday { get; set; } = new();
        public Dictionary<string, string> Workday { get; set; } = new();
    }

    private static readonly Dictionary<int, YearData> StaticData = new()
    {
        [2025] = new YearData
        {
            Holiday = new Dictionary<string, string>
            {
                ["2025-01-01"] = "元旦", ["2025-01-28"] = "除夕", ["2025-01-29"] = "初一",
                ["2025-01-30"] = "初二", ["2025-01-31"] = "初三", ["2025-02-01"] = "初四",
                ["2025-02-02"] = "初五", ["2025-02-03"] = "初六", ["2025-02-04"] = "初七",
                ["2025-04-04"] = "清明节", ["2025-04-05"] = "清明节", ["2025-04-06"] = "清明节",
                ["2025-05-01"] = "劳动节", ["2025-05-02"] = "劳动节", ["2025-05-03"] = "劳动节",
                ["2025-05-04"] = "劳动节", ["2025-05-05"] = "劳动节",
                ["2025-05-31"] = "端午节", ["2025-06-01"] = "端午节", ["2025-06-02"] = "端午节",
                ["2025-10-01"] = "国庆节", ["2025-10-02"] = "国庆节", ["2025-10-03"] = "国庆节",
                ["2025-10-04"] = "国庆节", ["2025-10-05"] = "国庆节", ["2025-10-06"] = "中秋节",
                ["2025-10-07"] = "国庆节", ["2025-10-08"] = "国庆节"
            },
            Workday = new Dictionary<string, string>
            {
                ["2025-01-26"] = "春节前补班", ["2025-02-08"] = "春节后补班",
                ["2025-04-27"] = "劳动节前补班", ["2025-09-28"] = "国庆节前补班",
                ["2025-10-11"] = "国庆节后补班"
            }
        },
        [2026] = new YearData
        {
            Holiday = new Dictionary<string, string>
            {
                ["2026-01-01"] = "元旦", ["2026-01-02"] = "元旦", ["2026-01-03"] = "元旦",
                ["2026-02-15"] = "春节", ["2026-02-16"] = "除夕", ["2026-02-17"] = "初一",
                ["2026-02-18"] = "初二", ["2026-02-19"] = "初三", ["2026-02-20"] = "初四",
                ["2026-02-21"] = "初五", ["2026-02-22"] = "初六", ["2026-02-23"] = "初七",
                ["2026-04-04"] = "清明节", ["2026-04-05"] = "清明节", ["2026-04-06"] = "清明节",
                ["2026-05-01"] = "劳动节", ["2026-05-02"] = "劳动节", ["2026-05-03"] = "劳动节",
                ["2026-05-04"] = "劳动节", ["2026-05-05"] = "劳动节",
                ["2026-06-19"] = "端午节", ["2026-06-20"] = "端午节", ["2026-06-21"] = "端午节",
                ["2026-09-25"] = "中秋节", ["2026-09-26"] = "中秋节", ["2026-09-27"] = "中秋节",
                ["2026-10-01"] = "国庆节", ["2026-10-02"] = "国庆节", ["2026-10-03"] = "国庆节",
                ["2026-10-04"] = "国庆节", ["2026-10-05"] = "国庆节", ["2026-10-06"] = "国庆节",
                ["2026-10-07"] = "国庆节"
            },
            Workday = new Dictionary<string, string>
            {
                ["2026-01-04"] = "元旦后补班", ["2026-02-14"] = "春节前补班",
                ["2026-02-28"] = "春节后补班", ["2026-05-09"] = "劳动节后补班",
                ["2026-09-20"] = "中秋节前补班", ["2026-10-10"] = "国庆节后补班"
            }
        }
    };

    // 运行时在线拉取缓存（静态数据之外的年份）
    private static readonly Dictionary<int, YearData> RuntimeCache = new();
    private static readonly HashSet<int> FailedYears = new();
    private static readonly HttpClient Http = new();

    /// <summary>查询某日节假日/调休信息；无记录返回 null</summary>
    public static HolidayInfo? InfoOf(string date)
    {
        var year = int.Parse(date[..4]);
        if (!StaticData.TryGetValue(year, out var data) &&
            !RuntimeCache.TryGetValue(year, out data))
            return null;
        if (data.Holiday.TryGetValue(date, out var h)) return new(HolidayKind.Holiday, h);
        if (data.Workday.TryGetValue(date, out var w)) return new(HolidayKind.AdjustedWork, w);
        return null;
    }

    /// <summary>该日是否为休息日（法定假日，或未被调休占用的周末）</summary>
    public static bool IsRestDay(string date)
    {
        var info = InfoOf(date);
        if (info?.Kind == HolidayKind.Holiday) return true;
        if (info?.Kind == HolidayKind.AdjustedWork) return false;
        var dow = (int)System.DateTime.Parse(date).DayOfWeek;
        return dow is 0 or 6;
    }

    /// <summary>某年是否有数据（静态或已在线拉取）</summary>
    public static bool HasYear(int year) =>
        StaticData.ContainsKey(year) || RuntimeCache.ContainsKey(year);

    /// <summary>按需拉取某年数据（已有则直接返回；失败返回 false）</summary>
    public static async Task<bool> LoadYear(int year)
    {
        if (HasYear(year)) return true;
        if (FailedYears.Contains(year)) return false;
        var data = await FetchYear(year).ConfigureAwait(false);
        if (data is null) { FailedYears.Add(year); return false; }
        RuntimeCache[year] = data;
        return true;
    }

    /// <summary>强制重新拉取（"更新日历"按钮）</summary>
    public static async Task<YearData?> RefreshYear(int year)
    {
        FailedYears.Remove(year);
        RuntimeCache.Remove(year);
        if (StaticData.ContainsKey(year)) return StaticData[year];
        var data = await FetchYear(year).ConfigureAwait(false);
        if (data is not null) RuntimeCache[year] = data;
        return data;
    }

    /// <summary>timor.tech 官方节假日接口（对齐主进程 holiday:fetch）</summary>
    private static async Task<YearData?> FetchYear(int year)
    {
        try
        {
            using var doc = JsonDocument.Parse(
                await Http.GetStringAsync($"https://timor.tech/api/holiday/year/{year}"));
            var root = doc.RootElement;
            if (root.TryGetProperty("code", out var code) && code.GetInt32() != 0) return null;
            if (!root.TryGetProperty("holiday", out var holiday)) return null;

            var data = new YearData();
            foreach (var entry in holiday.EnumerateObject())
            {
                var item = entry.Value;
                var date = item.TryGetProperty("date", out var d) && d.ValueKind == JsonValueKind.String
                    ? d.GetString()
                    : $"{year}-{entry.Name}";
                if (date is null) continue;
                var name = item.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                var isHoliday = item.TryGetProperty("holiday", out var h) && h.GetBoolean();
                if (isHoliday) data.Holiday[date] = name;
                else data.Workday[date] = name;
            }
            return data;
        }
        catch
        {
            return null;
        }
    }
}
