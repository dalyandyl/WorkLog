using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using System.Linq;
using Windows.UI;
using WorkLog_WinUI.Dialogs;
using WorkLog_WinUI.Services;

namespace WorkLog_WinUI.Pages;

/// <summary>标签色点（绑定用）</summary>
public record TagDot(Color Color);

/// <summary>日报行视图模型（含时间线文案）</summary>
public record DayRow(
    string Id,
    string Title,
    bool Done,
    string SubtaskSummary,
    Visibility SubtaskBadgeVis,
    ObservableCollection<TagDot> TagDots,
    string TimeLine);

public sealed partial class DayPage : Page
{
    private readonly ObservableCollection<DayRow> _rows = new();
    private string _currentDate = "";
    private string _selectedTaskId = "";

    /// <summary>侧栏日历点击日期时设置的待导航日期（Loaded 时消费并清除）</summary>
    public static string? PendingNavigateDate { get; set; }

    public DayPage()
    {
        InitializeComponent();
        TaskList.ItemsSource = _rows;
        DatePick.SelectedDate = DateTime.Today.ToString("yyyy-MM-dd");
        Loaded += (_, _) =>
        {
            if (PendingNavigateDate is string d)
            {
                PendingNavigateDate = null;
                DatePick.SelectedDate = d;
            }
            LoadDay();
        };
    }

    /// <summary>侧栏日历点击日期：直接切换当前日报视图（已在日报页时的入口）</summary>
    public void NavigateToDate(string date)
    {
        DatePick.SelectedDate = date;
        LoadDay();
    }

    private void DatePick_DatePicked(object? sender, string date) => LoadDay();

    private void PrevDayBtn_Click(object sender, RoutedEventArgs e)
    {
        DatePick.SelectedDate = DateTime.ParseExact(_currentDate, "yyyy-MM-dd", null).AddDays(-1).ToString("yyyy-MM-dd");
        LoadDay();
    }

    private void NextDayBtn_Click(object sender, RoutedEventArgs e)
    {
        DatePick.SelectedDate = DateTime.ParseExact(_currentDate, "yyyy-MM-dd", null).AddDays(1).ToString("yyyy-MM-dd");
        LoadDay();
    }

    private void TodayBtn_Click(object sender, RoutedEventArgs e)
    {
        DatePick.SelectedDate = DateTime.Today.ToString("yyyy-MM-dd");
        LoadDay();
    }

    private void LoadDay()
    {
        _rows.Clear();
        _selectedTaskId = "";
        _currentDate = DatePick.SelectedDate;
        if (_currentDate.Length != 10) return;

        var tasks = App.Data.ReadTasks(_currentDate);
        var tags = App.Data.ReadTags();
        var tagMap = tags.ToDictionary(t => t.Id, t => t);
        var isRest = App.Data.IsRest(_currentDate);

        foreach (var t in tasks)
        {
            var dots = new ObservableCollection<TagDot>();
            foreach (var tid in t.Tags)
                if (tagMap.TryGetValue(tid, out var tag))
                    dots.Add(new TagDot(ParseHex(tag.Color)));

            var timeLine = $"派发 {FormatIso(t.PublishedAt)}";
            if (t.CompletedAt is string c && c.Length > 0)
                timeLine += $" · 完成于 {FormatIso(c)}";

            _rows.Add(new DayRow(
                t.Id,
                t.Title,
                t.Done,
                t.Subtasks.Count > 0 ? $"{t.Subtasks.Count(s => s.Done)}/{t.Subtasks.Count}" : "",
                t.Subtasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed,
                dots,
                timeLine));
        }

        // 头栏状态
        var weekday = "周" + "一二三四五六日"[((int)DateTime.ParseExact(_currentDate, "yyyy-MM-dd", null).DayOfWeek + 6) % 7];
        WeekdayText.Text = weekday;
        RecordText.Text = tasks.Count > 0 ? "已记录" : "未填写";
        RecordBadge.Visibility = Visibility.Visible;

        // 休息日（勾选不触发事件：先解绑语义上由 flag 控制，这里直接置值）
        _restToggling = true;
        RestCheck.IsChecked = isRest;
        _restToggling = false;

        // 汇总
        var done = tasks.Count(t => t.Done);
        SummaryText.Text = tasks.Count > 0
            ? $"共 {tasks.Count} 项，已完成 {done} 项"
            : "";
        DevBadge.Visibility = App.Data.IsDevRoot ? Visibility.Visible : Visibility.Collapsed;
        EmptyState.Visibility = tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TaskList.Visibility = tasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        ShowDetail(null);

        // 同步侧栏日历
        if (App.MainWin is { } win)
        {
            win.SidebarCalendar.SelectedDate = _currentDate;
            win.RefreshCalendarMarkers();
        }
    }

    private bool _restToggling;

    private void RestCheck_Changed(object sender, RoutedEventArgs e)
    {
        if (_restToggling || _currentDate.Length != 10) return;
        if (sender is CheckBox cb && cb.IsChecked is bool rest)
            App.Data.SetRest(_currentDate, rest);
    }

    // ---------------- 详情面板 ----------------

    private void TaskList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is DayRow row)
            ShowDetail(row.Id);
    }

    private void ShowDetail(string? taskId)
    {
        if (taskId is null)
        {
            DetailEmpty.Visibility = Visibility.Visible;
            DetailPanel.Visibility = Visibility.Collapsed;
            return;
        }

        var task = App.Data.ReadTasks(_currentDate).FirstOrDefault(t => t.Id == taskId);
        if (task is null) return;
        _selectedTaskId = taskId;

        var tags = App.Data.ReadTags();
        var tagMap = tags.ToDictionary(t => t.Id, t => t);

        DetailTitle.Text = task.Title.Length > 0 ? task.Title : "（未命名）";
        DetailTags.Text = task.Tags.Count == 0
            ? "（无标签）"
            : string.Join(" · ", task.Tags.Where(tagMap.ContainsKey).Select(id => tagMap[id].Name));
        DetailPublished.Text = $"派发：{FormatIso(task.PublishedAt)}";
        DetailCompleted.Text = task.CompletedAt is string c && c.Length > 0
            ? $"完成：{FormatIso(c)}"
            : "完成：未完成";

        // 子任务
        DetailSubtasks.Children.Clear();
        DetailSubtaskHeader.Visibility = task.Subtasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var s in task.Subtasks)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing =8 };
            row.Children.Add(new FontIcon
            {
                Glyph = s.Done ? "\uE73E" : "\uE739",
                FontSize = 13,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources[
                    s.Done ? "AccentFillColorDefaultBrush" : "TextFillColorTertiaryBrush"]
            });
            row.Children.Add(new TextBlock { Text = s.Title, VerticalAlignment = VerticalAlignment.Center });
            DetailSubtasks.Children.Add(row);
        }

        DetailBody.Text = task.Body.Length > 0 ? task.Body : "暂无正文";
        var hasNote = task.Note.Trim().Length > 0;
        DetailNoteHeader.Visibility = hasNote ? Visibility.Visible : Visibility.Collapsed;
        DetailNoteBorder.Visibility = hasNote ? Visibility.Visible : Visibility.Collapsed;
        DetailNote.Text = task.Note;

        DetailEmpty.Visibility = Visibility.Collapsed;
        DetailPanel.Visibility = Visibility.Visible;
    }

    private void DetailEdit_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedTaskId.Length == 0) return;
        EditTaskById(_selectedTaskId);
    }

    private async void EditTaskById(string id)
    {
        var task = App.Data.ReadTasks(_currentDate).FirstOrDefault(t => t.Id == id);
        if (task is null) return;
        var dialog = TaskEditDialog.Edit(_currentDate, task);
        dialog.XamlRoot = XamlRoot;
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            LoadDay();
            ShowDetail(id);
        }
    }

    private void DetailDelete_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedTaskId.Length == 0) return;
        App.Data.TrashTask(_currentDate, _selectedTaskId);
        LoadDay();
    }

    /// <summary>勾选完成：写回共享 JSON（多天同步），Electron 版重进页面即可见</summary>
    private void TaskCheck_Click(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox cb && cb.Tag is string id && cb.IsChecked is bool done)
        {
            App.Data.SetTaskDone(_currentDate, id, done);
            LoadDay();
            ShowDetail(done ? null : id);
        }
    }

    private void AddBtn_Click(object sender, RoutedEventArgs e)
    {
        var dialog = TaskEditDialog.Create(_currentDate);
        dialog.XamlRoot = XamlRoot;
        _ = ShowAndReload(dialog);
    }

    private async System.Threading.Tasks.Task ShowAndReload(ContentDialog dialog)
    {
        await dialog.ShowAsync();
        LoadDay();
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

    private static string FormatIso(string iso)
    {
        if (DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out var d))
            return d.ToLocalTime().ToString("yyyy/M/d HH:mm:ss");
        return iso;
    }
}
