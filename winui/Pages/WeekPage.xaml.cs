using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;

namespace WorkLog_WinUI.Pages;

/// <summary>周报行视图模型</summary>
public record WeekRow(string DayLabel, string Date, string Summary, double BarWidth);

public sealed partial class WeekPage : Page
{
    private static readonly string[] DayNames = { "周一", "周二", "周三", "周四", "周五", "周六", "周日" };
    private readonly ObservableCollection<WeekRow> _rows = new();

    public WeekPage()
    {
        InitializeComponent();
        WeekList.ItemsSource = _rows;
        Loaded += (_, _) => LoadWeek();
    }

    private void LoadWeek()
    {
        _rows.Clear();
        var today = DateTime.Today;
        // 周一起始（对齐 Electron 版 getWeekInfo）
        var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));

        for (var i = 0; i < 7; i++)
        {
            var day = monday.AddDays(i);
            var date = day.ToString("yyyy-MM-dd");
            var tasks = App.Data.ReadTasks(date);
            var done = tasks.Count(t => t.Done);
            var ratio = tasks.Count > 0 ? (double)done / tasks.Count : 0;

            _rows.Add(new WeekRow(
                DayNames[i],
                date,
                tasks.Count > 0 ? $"{done}/{tasks.Count} 完成" : "—",
                Math.Max(4, ratio * 260)));
        }

        TitleText.Text = $"周报 · {monday:yyyy-MM-dd} ~ {monday.AddDays(6):yyyy-MM-dd}";
    }
}
