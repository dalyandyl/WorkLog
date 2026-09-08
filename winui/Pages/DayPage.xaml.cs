using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using Windows.UI;

namespace WorkLog_WinUI.Pages;

/// <summary>标签色点（绑定用）</summary>
public record TagDot(Color Color);

/// <summary>日报行视图模型</summary>
public record DayRow(
    string Title,
    bool Done,
    string SubtaskSummary,
    Visibility SubtaskBadgeVis,
    ObservableCollection<TagDot> TagDots);

public sealed partial class DayPage : Page
{
    private readonly ObservableCollection<DayRow> _rows = new();

    public DayPage()
    {
        InitializeComponent();
        TaskList.ItemsSource = _rows;
        DatePick.Date = DateTimeOffset.Now;
        Loaded += (_, _) => LoadDay();
    }

    private void DatePick_DateChanged(object? sender, DatePickerValueChangedEventArgs e)
    {
        LoadDay();
    }

    private void TodayBtn_Click(object sender, RoutedEventArgs e)
    {
        DatePick.Date = DateTimeOffset.Now;
    }

    private void LoadDay()
    {
        _rows.Clear();
        var d = DatePick.Date;

        var date = d.ToString("yyyy-MM-dd");
        var tasks = App.Data.ReadTasks(date);
        var tags = App.Data.ReadTags();
        var tagColor = tags.ToDictionary(t => t.Id, t => t.Color);

        foreach (var t in tasks)
        {
            var dots = new ObservableCollection<TagDot>();
            foreach (var tid in t.Tags)
            {
                if (tagColor.TryGetValue(tid, out var hex))
                    dots.Add(new TagDot(ParseHex(hex)));
            }

            _rows.Add(new DayRow(
                t.Title,
                t.Done,
                t.Subtasks.Count > 0 ? $"{t.Subtasks.Count(s => s.Done)}/{t.Subtasks.Count}" : "",
                t.Subtasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed,
                dots));
        }

        var done = tasks.Count(t => t.Done);
        TitleText.Text = $"日报 · {date}";
        SummaryText.Text = tasks.Count > 0
            ? $"共 {tasks.Count} 项，已完成 {done} 项"
            : "";
        EmptyState.Visibility = tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TaskList.Visibility = tasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    internal static Color ParseHex(string hex)
    {
        hex = hex.TrimStart('#');
        if (hex.Length == 6)
            return Color.FromArgb(255,
                Convert.ToByte(hex[0..2], 16),
                Convert.ToByte(hex[2..4], 16),
                Convert.ToByte(hex[4..6], 16));
        return Color.FromArgb(255, 59, 130, 246);
    }
}
