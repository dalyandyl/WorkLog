using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using WorkLog_WinUI.Controls;
using WorkLog_WinUI.Models;

namespace WorkLog_WinUI.Pages;

/// <summary>待发布任务（对齐原版 PendingTask）</summary>
public class PendingTask
{
    public string Title { get; set; } = "";
    public List<Subtask> Subtasks { get; set; } = new();
    public string Body { get; set; } = "";
    public bool RangeMode { get; set; }
    public string SingleDate { get; set; } = DateTime.Today.ToString("yyyy-MM-dd");
    public string Start { get; set; } = DateTime.Today.ToString("yyyy-MM-dd");
    public string End { get; set; } = DateTime.Today.ToString("yyyy-MM-dd");
}

/// <summary>已发布任务行（date|taskId 作为键）</summary>
public record PublishedRow(string Key, string Title, string Detail, bool Done);

/// <summary>发布历史行</summary>
public record HistoryRow(string Id, string Title, string Detail);

public sealed partial class PublishPage : Page
{
    private readonly ObservableCollection<PublishedRow> _published = new();
    private readonly ObservableCollection<HistoryRow> _history = new();
    private readonly List<PendingTask> _pending = new();
    private bool _showHistory; // false = 已发布任务 Tab

    public PublishPage()
    {
        InitializeComponent();
        PublishedList.ItemsSource = _published;
        HistoryList.ItemsSource = _history;
        // 初始化 Tab 样式与列表可见性（此前需手动点一次 Tab 才有内容）
        Loaded += (_, _) => SwitchTab(false);
    }

    // ---------------- Tab 切换 ----------------

    private void TabPublished_Click(object sender, RoutedEventArgs e) => SwitchTab(false);
    private void TabHistory_Click(object sender, RoutedEventArgs e) => SwitchTab(true);

    private void SwitchTab(bool history)
    {
        _showHistory = history;
        PendingArea.Visibility = Visibility.Collapsed;
        StyleTab(TabPublished, !history, "已发布任务");
        StyleTab(TabHistory, history, "发布历史");

        PublishedList.Visibility = !history ? Visibility.Visible : Visibility.Collapsed;
        HistoryList.Visibility = history ? Visibility.Visible : Visibility.Collapsed;
        LoadCurrentTab();
    }

    private void StyleTab(Button tab, bool active, string text)
    {
        tab.Content = text;
        if (active)
        {
            tab.Background = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
            tab.Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];
        }
        else
        {
            tab.Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"];
            tab.Foreground = (Brush)Application.Current.Resources["TextFillColorPrimaryBrush"];
        }
    }

    private void LoadCurrentTab()
    {
        if (_showHistory) LoadHistory(); else LoadPublished();
    }

    // ---------------- 已发布任务 ----------------

    private void LoadPublished()
    {
        _published.Clear();
        foreach (var d in App.Data.ListDatesWithTasks().AsEnumerable().Reverse())
        {
            foreach (var t in App.Data.ReadTasks(d))
            {
                var detail = $"{d} · 派发 {FormatIso(t.PublishedAt)}";
                if (t.CompletedAt is string c && c.Length > 0)
                    detail += $" · 完成于 {FormatIso(c)}";
                _published.Add(new PublishedRow($"{d}|{t.Id}", t.Title, detail, t.Done));
            }
        }
        if (_published.Count == 0)
            ShowResult(InfoBarSeverity.Informational, "暂无已发布任务，点击右上角「发布任务」开始");
    }

    private void PublishedCheck_Click(object sender, RoutedEventArgs e)
    {
        if (sender is CheckBox cb && cb.Tag is string key)
        {
            var i = key.IndexOf('|');
            var date = key[..i];
            var id = key[(i + 1)..];
            if (cb.IsChecked is bool done)
            {
                App.Data.SetTaskDone(date, id, done);
                LoadPublished();
            }
        }
    }

    // ---------------- 发布历史 ----------------

    private void LoadHistory()
    {
        _history.Clear();
        foreach (var r in App.Data.ReadPublishRecords())
        {
            var range = r.Dates.Count == 1
                ? r.Dates[0]
                : $"{r.Dates.Count} 天（{r.Dates.Min()} ~ {r.Dates.Max()}）";
            _history.Add(new HistoryRow(r.Id, r.Title, $"发布于 {FormatIso(r.PublishedAt)} · {range}"));
        }
        if (_history.Count == 0)
            ShowResult(InfoBarSeverity.Informational, "暂无发布历史");
    }

    private void RemoveRecord_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is string id)
        {
            App.Data.RemovePublishRecord(id);
            LoadHistory();
        }
    }

    // ---------------- 待发布表单 ----------------

    private void NewPendingBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_pending.Count == 0) _pending.Add(new PendingTask());
        _showHistory = false;
        StyleTab(TabPublished, true, "已发布任务");
        StyleTab(TabHistory, false, "发布历史");
        PublishedList.Visibility = Visibility.Collapsed;
        HistoryList.Visibility = Visibility.Collapsed;
        ResultBar.IsOpen = false;
        PendingArea.Visibility = Visibility.Visible;
        RebuildList();
    }

    protected override void OnNavigatedFrom(Microsoft.UI.Xaml.Navigation.NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        _pending.Clear(); // 离开页面丢弃未发布草稿
    }

    private void CancelPending_Click(object sender, RoutedEventArgs e)
    {
        _pending.Clear();
        PendingArea.Visibility = Visibility.Collapsed;
        SwitchTab(false);
    }

    private void RebuildList()
    {
        PendingList.Children.Clear();
        foreach (var p in _pending)
            PendingList.Children.Add(BuildCard(p));
    }

    /// <summary>待发布任务卡片（对齐原版 PendingTaskCard 布局）</summary>
    private Border BuildCard(PendingTask p)
    {
        var card = new Border
        {
            Padding = new Thickness(16),
            CornerRadius = new CornerRadius(8),
            MaxWidth = 560,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Style = (Style)Application.Current.Resources["CardStyle"]
        };
        var panel = new StackPanel { Spacing = 12 };
        card.Child = panel;

        // ---- 标题行 + 移除 ----
        var head = new Grid { ColumnSpacing = 8 };
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Auto) });

        var titleBox = new TextBox { PlaceholderText = "任务标题", Text = p.Title };
        titleBox.TextChanged += (_, _) => p.Title = titleBox.Text;
        var removeBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE711", FontSize = 13 },
            Padding = new Thickness(8, 4, 8, 4),
            Background = null,
            BorderThickness = new Thickness(0)
        };
        removeBtn.Click += (_, _) => { _pending.Remove(p); if (_pending.Count == 0) _pending.Add(new PendingTask()); RebuildList(); };

        Grid.SetColumn(titleBox, 0);
        Grid.SetColumn(removeBtn, 1);
        head.Children.Add(titleBox);
        head.Children.Add(removeBtn);
        panel.Children.Add(head);

        // ---- 单日 / 区间 ----
        var modePanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var singleRb = new RadioButton { Content = "单日", IsChecked = !p.RangeMode };
        var rangeRb = new RadioButton { Content = "区间" };
        singleRb.Checked += (_, _) => { p.RangeMode = false; RebuildList(); };
        rangeRb.Checked += (_, _) => { p.RangeMode = true; RebuildList(); };
        modePanel.Children.Add(singleRb);
        modePanel.Children.Add(rangeRb);
        panel.Children.Add(modePanel);

        // ---- 日期选择（按模式） ----
        var datePanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (!p.RangeMode)
        {
            datePanel.Children.Add(MakePicker(p.SingleDate, v => p.SingleDate = v));
        }
        else
        {
            datePanel.Children.Add(MakePicker(p.Start, v => p.Start = v));
            datePanel.Children.Add(new TextBlock { Text = "至", VerticalAlignment = VerticalAlignment.Center });
            datePanel.Children.Add(MakePicker(p.End, v => p.End = v));
        }
        panel.Children.Add(datePanel);

        // ---- 正文 ----
        var bodyBox = new TextBox
        {
            Header = "正文（Markdown，可选）",
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 60,
            Text = p.Body
        };
        bodyBox.TextChanged += (_, _) => p.Body = bodyBox.Text;
        panel.Children.Add(bodyBox);

        return card;
    }

    private StackPanel MakePicker(string value, Action<string> set)
    {
        var host = new StackPanel { Spacing = 4 };
        var picker = new WlDatePicker { SelectedDate = value };
        picker.DatePicked += (_, v) => set(v);
        host.Children.Add(picker);
        return host;
    }

    /// <summary>发布全部待发布任务</summary>
    private void PublishAllBtn_Click(object sender, RoutedEventArgs e)
    {
        var valid = _pending.Where(p => p.Title.Trim().Length > 0).ToList();
        if (valid.Count == 0)
        {
            ShowResult(InfoBarSeverity.Error, "请至少填写一个任务标题");
            return;
        }

        var total = 0;
        var bad = new List<string>();
        foreach (var p in valid)
        {
            List<string> dates;
            if (!p.RangeMode)
            {
                dates = new List<string> { p.SingleDate };
            }
            else
            {
                if (p.End.CompareTo(p.Start) < 0) { bad.Add($"「{p.Title}」区间无效"); continue; }
                dates = EnumerateDates(p.Start, p.End);
                if (dates.Count > 366) { bad.Add($"「{p.Title}」范围超过一年"); continue; }
            }
            total += App.Data.PublishTasks(dates, p.Title, p.Body, p.Subtasks);
        }

        _pending.Clear();
        PendingArea.Visibility = Visibility.Collapsed;
        SwitchTab(false);
        ShowResult(InfoBarSeverity.Success,
            bad.Count == 0
                ? $"已发布 {valid.Count} 个任务，覆盖 {total} 天"
                : $"已发布 {total} 天；{string.Join("；", bad)}");
        App.MainWin?.RefreshCalendarMarkers();
    }

    private static List<string> EnumerateDates(string start, string end)
    {
        var dates = new List<string>();
        for (var d = DateTime.Parse(start); d <= DateTime.Parse(end); d = d.AddDays(1))
            dates.Add(d.ToString("yyyy-MM-dd"));
        return dates;
    }

    private static string FormatIso(string iso)
    {
        if (DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out var d))
            return d.ToLocalTime().ToString("yyyy/M/d HH:mm:ss");
        return iso;
    }

    private void ShowResult(InfoBarSeverity severity, string message)
    {
        ResultBar.Severity = severity;
        ResultBar.Message = message;
        ResultBar.IsOpen = true;
    }
}
