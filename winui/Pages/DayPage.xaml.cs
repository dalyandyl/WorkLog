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
    string Id,
    string Title,
    bool Done,
    string SubtaskSummary,
    Visibility SubtaskBadgeVis,
    ObservableCollection<TagDot> TagDots);

public sealed partial class DayPage : Page
{
    private readonly ObservableCollection<DayRow> _rows = new();
    private string _currentDate = "";

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

        _currentDate = d.ToString("yyyy-MM-dd");
        var tasks = App.Data.ReadTasks(_currentDate);
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
                t.Id,
                t.Title,
                t.Done,
                t.Subtasks.Count > 0 ? $"{t.Subtasks.Count(s => s.Done)}/{t.Subtasks.Count}" : "",
                t.Subtasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed,
                dots));
        }

        var done = tasks.Count(t => t.Done);
        TitleText.Text = $"日报 · {_currentDate}";
        SummaryText.Text = tasks.Count > 0
            ? $"共 {tasks.Count} 项，已完成 {done} 项"
            : "";
        DevBadge.Visibility = App.Data.IsDevRoot ? Visibility.Visible : Visibility.Collapsed;
        EmptyState.Visibility = tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TaskList.Visibility = tasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>勾选完成：写回共享 JSON（多天同步），Electron 版重进页面即可见</summary>
    private void TaskCheck_Click(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox cb && cb.Tag is string id && cb.IsChecked is bool done)
        {
            App.Data.SetTaskDone(_currentDate, id, done);
        }
    }

    /// <summary>新建任务</summary>
    private async void AddBtn_Click(object sender, RoutedEventArgs e)
    {
        var input = new TextBox { PlaceholderText = "任务标题" };
        var dialog = new ContentDialog
        {
            Title = $"新建任务 · {_currentDate}",
            Content = input,
            PrimaryButtonText = "创建",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            var title = input.Text.Trim();
            if (title.Length > 0)
            {
                App.Data.CreateTask(_currentDate, title);
                LoadDay();
            }
        }
    }

    private void DeleteItem_Click(object sender, RoutedEventArgs e)
    {
        // MenuFlyoutItem 在 Flyout 内，取父级 Button 的 Tag（任务 id）
        if (sender is MenuFlyoutItem item &&
            item.Parent is MenuFlyout flyout &&
            flyout.Target is Button btn &&
            btn.Tag is string id)
        {
            App.Data.DeleteTask(_currentDate, id);
            LoadDay();
        }
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
