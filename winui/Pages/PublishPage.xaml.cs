using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;

namespace WorkLog_WinUI.Pages;

public sealed partial class PublishPage : Page
{
    public PublishPage()
    {
        InitializeComponent();
        StartPick.Date = DateTimeOffset.Now;
        EndPick.Date = DateTimeOffset.Now;
    }

    private List<string>? CollectDates()
    {
        if (StartPick.Date is not DateTimeOffset s || EndPick.Date is not DateTimeOffset e) return null;
        if (e < s) return null;

        var dates = new List<string>();
        for (var d = s.Date; d <= e.Date; d = d.AddDays(1))
            dates.Add(d.ToString("yyyy-MM-dd"));
        // 防御：最多 366 天
        return dates.Count > 366 ? null : dates;
    }

    private void PreviewBtn_Click(object sender, RoutedEventArgs e)
    {
        var dates = CollectDates();
        if (dates is null)
        {
            RangeHint.Severity = InfoBarSeverity.Error;
            RangeHint.Message = "日期无效（开始 > 结束，或范围超过一年）";
        }
        else
        {
            RangeHint.Severity = InfoBarSeverity.Informational;
            RangeHint.Message = $"将派发到 {dates.Count} 天：{dates[0]} ~ {dates[^1]}";
        }
        RangeHint.IsOpen = true;
    }

    private async void PublishBtn_Click(object sender, RoutedEventArgs e)
    {
        var title = TitleBox.Text.Trim();
        var dates = CollectDates();

        if (title.Length == 0)
        {
            ShowResult(InfoBarSeverity.Error, "请填写任务标题");
            return;
        }
        if (dates is null)
        {
            ShowResult(InfoBarSeverity.Error, "日期无效（开始 > 结束，或范围超过一年）");
            return;
        }

        var count = App.Data.PublishTasks(dates, title, BodyBox.Text, new());
        ShowResult(InfoBarSeverity.Success, $"已派发到 {count} 天，可在日报页查看");

        TitleBox.Text = "";
        BodyBox.Text = "";
    }

    private void ShowResult(InfoBarSeverity severity, string message)
    {
        ResultBar.Severity = severity;
        ResultBar.Message = message;
        ResultBar.IsOpen = true;
    }
}
