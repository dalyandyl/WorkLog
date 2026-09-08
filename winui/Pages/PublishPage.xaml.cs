using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.Generic;
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

public sealed partial class PublishPage : Page
{
    private readonly List<PendingTask> _pending = new();

    public PublishPage()
    {
        InitializeComponent();
        if (_pending.Count == 0) _pending.Add(new PendingTask());
        RebuildList();
    }

    private void RebuildList()
    {
        PendingList.Children.Clear();

        if (_pending.Count == 0)
        {
            var hint = new TextBlock
            {
                Text = "点击右上角「新建待发布」添加任务",
                Style = (Style)Application.Current.Resources["PageSubtitle"],
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 24, 0, 24)
            };
            PendingList.Children.Add(hint);
        }

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
            Style = (Style)Application.Current.Resources["CardStyle"]
        };
        var panel = new StackPanel { Spacing = 12 };
        card.Child = panel;

        // ---- 标题行 + 移除 ----
        var head = new Grid { ColumnSpacing = 8 };
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Auto) });

        var titleBox = new TextBox
        {
            PlaceholderText = "任务标题",
            Header = p == _pending[0] ? "标题" : null,
            Text = p.Title
        };
        titleBox.TextChanged += (_, e) => p.Title = titleBox.Text;
        var removeBtn = new Button
        {
            Content = new FontIcon { Glyph = "\uE711", FontSize = 13 },
            Padding = new Thickness(8, 4, 8, 4),
            Background = null,
            BorderThickness = new Thickness(0)
        };
        removeBtn.Click += (_, _) => { _pending.Remove(p); RebuildList(); };

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
            var single = MakePicker(p.SingleDate, v => p.SingleDate = v, "发布日期");
            datePanel.Children.Add(single);
        }
        else
        {
            var start = MakePicker(p.Start, v => p.Start = v, "起始");
            datePanel.Children.Add(start);
            datePanel.Children.Add(new TextBlock { Text = "至", VerticalAlignment = VerticalAlignment.Center });
            var end = MakePicker(p.End, v => p.End = v, "结束");
            datePanel.Children.Add(end);
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

    private StackPanel MakePicker(string value, Action<string> set, string header)
    {
        var host = new StackPanel { Spacing = 4 };
        if (header.Length > 0)
            host.Children.Add(new TextBlock
            {
                Text = header,
                FontSize = 12,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["TextFillColorSecondaryBrush"]
            });

        var picker = new WlDatePicker { SelectedDate = value };
        picker.DatePicked += (_, v) => set(v);
        host.Children.Add(picker);
        return host;
    }

    private void NewPendingBtn_Click(object sender, RoutedEventArgs e)
    {
        _pending.Add(new PendingTask());
        RebuildList();
    }

    /// <summary>发布全部待发布任务（对齐原版 openForm/submit 流程的批量派发）</summary>
    private async void PublishAllBtn_Click(object sender, RoutedEventArgs e)
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
        _pending.Add(new PendingTask());
        RebuildList();

        var msg = bad.Count == 0
            ? $"已发布 {valid.Count} 个任务，覆盖 {total} 天"
            : $"已发布 {total} 天；{string.Join("；", bad)}";
        ShowResult(InfoBarSeverity.Success, msg);
    }

    private static List<string> EnumerateDates(string start, string end)
    {
        var dates = new List<string>();
        for (var d = DateTime.Parse(start); d <= DateTime.Parse(end); d = d.AddDays(1))
            dates.Add(d.ToString("yyyy-MM-dd"));
        return dates;
    }

    private void ShowResult(InfoBarSeverity severity, string message)
    {
        ResultBar.Severity = severity;
        ResultBar.Message = message;
        ResultBar.IsOpen = true;
    }
}
