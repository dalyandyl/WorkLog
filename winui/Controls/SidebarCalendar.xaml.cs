using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using WorkLog_WinUI.Services;

namespace WorkLog_WinUI.Controls;

/// <summary>
/// 侧栏常驻日历（对齐原版 Calendar.tsx）：
/// 节假日标红 + 圆点、调休"班"徽章、有任务日期标记、今天描边、选中强调。
/// 点击日期触发 DateSelected（主窗口导航到日报页）。
/// </summary>
public sealed partial class SidebarCalendar : UserControl
{
    /// <summary>点击某日（yyyy-MM-dd）</summary>
    public event EventHandler<string>? DateSelected;

    /// <summary>选中日期变化时同步标题年月</summary>
    public static readonly DependencyProperty SelectedDateProperty =
        DependencyProperty.Register(nameof(SelectedDate), typeof(string), typeof(SidebarCalendar),
            new PropertyMetadata("", OnSelectedDateChanged));

    public string SelectedDate
    {
        get => (string)GetValue(SelectedDateProperty);
        set => SetValue(SelectedDateProperty, value);
    }

    private static void OnSelectedDateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is SidebarCalendar c)
        {
            // 同步弹层选择器的值，但不跟随切换视图年月（仅当选中日在当前视图内时刷新高亮）
            c.TitlePick.SelectedDate = e.NewValue as string ?? "";
            var v = e.NewValue as string ?? "";
            if (v.Length == 10 &&
                int.Parse(v[..4]) == c._viewYear &&
                int.Parse(v.Substring(5, 2)) - 1 == c._viewMonth)
            {
                c.BuildMonth();
            }
        }
    }

    private int _viewYear;
    private int _viewMonth; // 0-11
    private HashSet<string> _markers = new();
    private bool _refreshing;

    public SidebarCalendar()
    {
        InitializeComponent();
        var b = SelectedDate.Length > 0 ? SelectedDate : TodayStr();
        _viewYear = int.Parse(b[..4]);
        _viewMonth = int.Parse(b.Substring(5, 2)) - 1;

        BuildWeekHeader();
        TitlePick.DatePicked += (_, date) =>
        {
            _viewYear = int.Parse(date[..4]);
            _viewMonth = int.Parse(date.Substring(5, 2)) - 1;
            DateSelected?.Invoke(this, date);
        };

        Loaded += async (_, _) => await EnsureYearData();
    }

    /// <summary>刷新任务标记（有任务的日期集合）</summary>
    public void SetMarkers(HashSet<string> dates)
    {
        _markers = dates;
        BuildMonth();
    }

    private static string TodayStr()
    {
        var n = DateTime.Today;
        return $"{n.Year:0000}-{n.Month:00}-{n.Day:00}";
    }

    private void SyncViewToSelected()
    {
        if (SelectedDate.Length != 10) return;
        _viewYear = int.Parse(SelectedDate[..4]);
        _viewMonth = int.Parse(SelectedDate.Substring(5, 2)) - 1;
        UpdateTitle();
        BuildMonth();
    }

    private void UpdateTitle() =>
        TitlePick.CustomLabel = $"{_viewYear} 年 {_viewMonth + 1} 月";

    private async Task EnsureYearData()
    {
        await Holidays.LoadYear(_viewYear);
        UpdateTitle();
        BuildMonth();
    }

    private void BuildWeekHeader()
    {
        WeekHeader.ColumnDefinitions.Clear();
        WeekHeader.Children.Clear();
        for (int i = 0; i < 7; i++)
        {
            WeekHeader.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            var lab = new TextBlock
            {
                Text = "一二三四五六日"[i].ToString(),
                FontSize = 11,
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)Application.Current.Resources["TextFillColorTertiaryBrush"]
            };
            Grid.SetColumn(lab, i);
            WeekHeader.Children.Add(lab);
        }
    }

    private void BuildMonth()
    {
        UpdateTitle();
        DayGrid.ColumnDefinitions.Clear();
        DayGrid.RowDefinitions.Clear();
        DayGrid.Children.Clear();
        for (int i = 0; i < 7; i++)
            DayGrid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });

        var lead = ((int)new DateTime(_viewYear, _viewMonth + 1, 1).DayOfWeek + 6) % 7; // 周一=0
        var daysInMonth = DateTime.DaysInMonth(_viewYear, _viewMonth + 1);
        var rows = (lead + daysInMonth + 6) / 7;
        for (int r = 0; r < rows; r++)
            DayGrid.RowDefinitions.Add(new() { Height = new GridLength(34) });

        var today = TodayStr();
        int col = 0, row = 0;
        for (int i = 0; i < lead; i++) { col++; if (col == 7) { col = 0; row++; } }

        var restBrush = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 0xE7, 0x4C, 0x3C));
        var normalBrush = (Brush)Application.Current.Resources["TextFillColorPrimaryBrush"];
        var markerBrush = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 0xF5, 0x9E, 0x0B));

        for (int d = 1; d <= daysInMonth; d++)
        {
            var ds = $"{_viewYear:0000}-{_viewMonth + 1:00}-{d:00}";
            var info = Holidays.InfoOf(ds);
            var rest = Holidays.IsRestDay(ds);
            var isSel = ds == SelectedDate;
            var isToday = ds == today;
            var hasTask = _markers.Contains(ds);

            var cell = new Button
            {
                Padding = new Thickness(0),
                Margin = new Thickness(1),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                VerticalContentAlignment = VerticalAlignment.Stretch,
                Background = null,
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(6),
                UseSystemFocusVisuals = false
            };

            // 内容：两行结构——上行（数字），下行（角标条），避免与数字重合
            var grid = new Grid();
            grid.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
            grid.RowDefinitions.Add(new() { Height = new GridLength(9) }); // 底部角标条

            var num = new TextBlock
            {
                Text = d.ToString(),
                FontSize = 12,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            Grid.SetRow(num, 0);
            grid.Children.Add(num);

            // 底部角标条：节假日红点 / 任务橙点（互不重叠、不遮数字）
            var badgeBar = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Spacing = 3
            };
            Grid.SetRow(badgeBar, 1);

            if (info?.Kind == HolidayKind.Holiday)
                badgeBar.Children.Add(new Ellipse { Width = 4, Height = 4, Fill = restBrush });

            if (hasTask)
                badgeBar.Children.Add(new Ellipse { Width = 4, Height = 4, Fill = markerBrush });

            if (badgeBar.Children.Count > 0)
                grid.Children.Add(badgeBar);

            // 调休"班"徽：右上角小标签（原版样式，不占数字空间）
            if (info?.Kind == HolidayKind.AdjustedWork)
            {
                var badge = new Border
                {
                    BorderThickness = new Thickness(1),
                    BorderBrush = restBrush,
                    CornerRadius = new CornerRadius(2),
                    Padding = new Thickness(1, 0, 1, 0),
                    HorizontalAlignment = HorizontalAlignment.Right,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(0, 0, 1, 0)
                };
                badge.Child = new TextBlock { Text = "班", FontSize = 8, Foreground = restBrush };
                Grid.SetRow(badge, 0);
                grid.Children.Add(badge);
            }

            cell.Content = grid;

            // 状态样式
            if (isSel)
            {
                cell.Background = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
                num.Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];
            }
            else
            {
                num.Foreground = rest ? restBrush : normalBrush;
                if (isToday)
                {
                    cell.BorderThickness = new Thickness(1);
                    cell.BorderBrush = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
                }
            }

            // 提示：节假日名 / 周末
            var tip = info is not null ? $"{ds}（{info.Name}）" : rest ? $"{ds}（周末）" : ds;
            ToolTipService.SetToolTip(cell, tip);

            var date = ds;
            cell.Click += (_, _) => DateSelected?.Invoke(this, date);

            Grid.SetColumn(cell, col);
            Grid.SetRow(cell, row);
            DayGrid.Children.Add(cell);

            col++;
            if (col == 7) { col = 0; row++; }
        }
    }

    private void PrevBtn_Click(object sender, RoutedEventArgs e) => ShiftMonth(-1);
    private void NextBtn_Click(object sender, RoutedEventArgs e) => ShiftMonth(1);

    private void ShiftMonth(int delta)
    {
        var m = _viewMonth + delta;
        if (m < 0) { _viewMonth = 11; _viewYear--; }
        else if (m > 11) { _viewMonth = 0; _viewYear++; }
        else _viewMonth = m;
        _ = EnsureYearData();
    }

    private void TodayBtn_Click(object sender, RoutedEventArgs e)
    {
        var now = DateTime.Today;
        _viewYear = now.Year;
        _viewMonth = now.Month - 1;
        _ = EnsureYearData();
        DateSelected?.Invoke(this, TodayStr());
    }

    private async void RefreshBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_refreshing) return;
        _refreshing = true;
        RefreshIcon.Glyph = "\uE712"; // 暂用齿轮样式占位旋转感
        StatusText.Text = "更新中…";

        var data = await Holidays.RefreshYear(_viewYear);

        RefreshIcon.Glyph = "\uE72C";
        _refreshing = false;
        var has = data is not null && (data.Holiday.Count > 0 || data.Workday.Count > 0);
        StatusText.Text = has
            ? "已更新"
            : $"{_viewYear} 年节假日安排尚未公布，仅周末标红";
        BuildMonth();
    }
}
