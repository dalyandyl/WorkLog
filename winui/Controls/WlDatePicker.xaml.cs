using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using System;

namespace WorkLog_WinUI.Controls;

/// <summary>
/// 复刻 Electron 版 DatePicker 的日期选择器：
/// 日/月/年三级视图（标题点击下钻）、周一起始、今天/选中高亮。
/// </summary>
public sealed partial class WlDatePicker : UserControl
{
    /// <summary>选中日期变化（yyyy-MM-dd）</summary>
    public event EventHandler<string>? DatePicked;

    public static readonly DependencyProperty SelectedDateProperty =
        DependencyProperty.Register(nameof(SelectedDate), typeof(string), typeof(WlDatePicker),
            new PropertyMetadata("", OnSelectedDateChanged));

    public string SelectedDate
    {
        get => (string)GetValue(SelectedDateProperty);
        set => SetValue(SelectedDateProperty, value);
    }

    private static void OnSelectedDateChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is WlDatePicker p)
            p.Label.Text = FormatDate(e.NewValue as string ?? "");
    }

    private enum DpView { Days, Months, Years }

    private DpView _view = DpView.Days;
    private int _viewYear;
    private int _viewMonth; // 0-11
    private Popup? _popup;

    // 弹层内容引用（Rebuild 时刷新）
    private TextBlock _titleText = null!;
    private StackPanel _contentHost = null!;
    private StackPanel _popupPanel = null!;

    public WlDatePicker()
    {
        InitializeComponent();
        var b = SelectedDate.Length > 0 ? SelectedDate : TodayStr();
        _viewYear = int.Parse(b[..4]);
        _viewMonth = int.Parse(b.Substring(5, 2)) - 1;
    }

    private static string TodayStr()
    {
        var n = DateTime.Today;
        return $"{n.Year:0000}-{n.Month:00}-{n.Day:00}";
    }

    private static string FormatDate(string v) =>
        v.Length == 10 ? $"{v[..4]} 年 {v.Substring(5, 2)} 月 {v.Substring(8, 2)} 日" : "选择日期";

    private void Trigger_Click(object sender, RoutedEventArgs e)
    {
        if (_popup is { IsOpen: true }) { _popup.IsOpen = false; return; }

        // 打开时回到选中日期所在月份、日视图（对齐原版）
        var b = SelectedDate.Length > 0 ? SelectedDate : TodayStr();
        _viewYear = int.Parse(b[..4]);
        _viewMonth = int.Parse(b.Substring(5, 2)) - 1;
        _view = DpView.Days;

        _titleText = new TextBlock();
        _contentHost = new StackPanel { Spacing = 4 };

        // 头部：‹ 标题 ›
        var prev = MakeNavBtn("‹", "上一个", () => ShiftBy(-1));
        var next = MakeNavBtn("›", "下一个", () => ShiftBy(1));
        var title = new Button
        {
            Content = _titleText,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            Background = null,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(4, 2, 4, 2)
        };
        title.Click += (_, _) =>
        {
            if (_view == DpView.Days) _view = DpView.Months;
            else if (_view == DpView.Months) _view = DpView.Years;
            Rebuild();
        };

        var head = new Grid { ColumnSpacing = 4 };
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Auto) });
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        head.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Auto) });
        Grid.SetColumn(prev, 0);
        Grid.SetColumn(title, 1);
        Grid.SetColumn(next, 2);
        head.Children.Add(prev);
        head.Children.Add(title);
        head.Children.Add(next);

        _popupPanel = new StackPanel { Spacing = 8 };
        _popupPanel.Children.Add(head);
        _popupPanel.Children.Add(_contentHost);

        var root = new Border
        {
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(8),
            Background = (Brush)Application.Current.Resources["AcrylicBackgroundFillColorDefaultBrush"],
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            Width = 280,
            Child = _popupPanel
        };

        _popup = new Popup { Child = root, XamlRoot = XamlRoot };

        // 手动定位到按钮下方（WinUI 3 Popup 无 Placement，加载后按触发按钮坐标偏移）
        root.Loaded += (_, _) =>
        {
            var pos = Trigger.TransformToVisual(null).TransformPoint(new Windows.Foundation.Point(0, 0));
            var flyoutH = root.ActualHeight > 0 ? root.ActualHeight : 320;
            var flyoutW = root.ActualWidth;
            var x = Math.Max(8, pos.X - flyoutW + Trigger.ActualWidth);
            var y = pos.Y + Trigger.ActualHeight + 6;
            _popup.HorizontalOffset = x;
            _popup.VerticalOffset = y;
        };

        _popup.IsOpen = true;
        Rebuild();
    }

    private void Rebuild()
    {
        _titleText.Text = _view switch
        {
            DpView.Days => $"{_viewYear} 年 {_viewMonth + 1} 月",
            DpView.Months => $"{_viewYear} 年",
            _ => $"{YearStart()} - {YearStart() + 11}"
        };

        _contentHost.Children.Clear();

        switch (_view)
        {
            case DpView.Days: BuildDays(); break;
            case DpView.Months: BuildMonthsOrYears(isMonths: true); break;
            case DpView.Years: BuildMonthsOrYears(isMonths: false); break;
        }
    }

    private void BuildDays()
    {
        // 星期表头（周一起始）
        var week = new Grid();
        for (int i = 0; i < 7; i++)
        {
            week.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            var lab = new TextBlock
            {
                Text = "一二三四五六日"[i].ToString(),
                FontSize = 11,
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)Application.Current.Resources["TextFillColorTertiaryBrush"]
            };
            Grid.SetColumn(lab, i);
            week.Children.Add(lab);
        }
        _contentHost.Children.Add(week);

        var grid = new Grid();
        for (int i = 0; i < 7; i++)
            grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });

        var lead = ((int)new DateTime(_viewYear, _viewMonth + 1, 1).DayOfWeek + 6) % 7; // 周一=0
        var daysInMonth = DateTime.DaysInMonth(_viewYear, _viewMonth + 1);
        var rows = (lead + daysInMonth + 6) / 7;
        for (int r = 0; r < rows; r++)
            grid.RowDefinitions.Add(new() { Height = new GridLength(38) });

        var today = TodayStr();
        int col = 0, row = 0;
        for (int i = 0; i < lead; i++) { AdvanceCell(ref col, ref row); }

        for (int d = 1; d <= daysInMonth; d++)
        {
            var ds = $"{_viewYear:0000}-{_viewMonth + 1:00}-{d:00}";
            var isSel = ds == SelectedDate;
            var isToday = ds == today;

            var dayBtn = new Button
            {
                Content = d.ToString(),
                FontSize = 13,
                Padding = new Thickness(0, 5, 0, 5),
                Margin = new Thickness(1),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Center,
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = null,
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(15)
            };
            if (isSel)
            {
                dayBtn.Background = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
                dayBtn.Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];
            }
            else if (isToday)
            {
                dayBtn.BorderThickness = new Thickness(1);
                dayBtn.BorderBrush = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
            }
            dayBtn.Click += (_, _) =>
            {
                SelectedDate = ds;
                DatePicked?.Invoke(this, ds);
                if (_popup != null) _popup.IsOpen = false;
            };

            Grid.SetColumn(dayBtn, col);
            Grid.SetRow(dayBtn, row);
            grid.Children.Add(dayBtn);
            AdvanceCell(ref col, ref row);
        }

        _contentHost.Children.Add(grid);
    }

    private void BuildMonthsOrYears(bool isMonths)
    {
        var g = new Grid { Margin = new Thickness(0, 4, 0, 0) };
        for (int i = 0; i < 4; i++)
            g.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        for (int r = 0; r < 3; r++)
            g.RowDefinitions.Add(new() { Height = new GridLength(40) });

        int count = 12;
        int ys = YearStart();
        for (int i = 0; i < count; i++)
        {
            var idx = i;
            var text = isMonths ? $"{i + 1} 月" : (ys + i).ToString();
            var selected = isMonths ? i == _viewMonth : ys + i == _viewYear;

            var cell = new Button
            {
                Content = text,
                FontSize = 13,
                Margin = new Thickness(2),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Center,
                VerticalContentAlignment = VerticalAlignment.Center,
                CornerRadius = new CornerRadius(6)
            };
            if (selected)
            {
                cell.Background = (Brush)Application.Current.Resources["AccentFillColorDefaultBrush"];
                cell.Foreground = (Brush)Application.Current.Resources["TextOnAccentFillColorPrimaryBrush"];
            }
            else
            {
                cell.Background = null;
                cell.BorderThickness = new Thickness(0);
            }
            cell.Click += (_, _) =>
            {
                if (isMonths) { _viewMonth = idx; _view = DpView.Days; }
                else { _viewYear = ys + idx; _view = DpView.Months; }
                Rebuild();
            };

            Grid.SetColumn(cell, i % 4);
            Grid.SetRow(cell, i / 4);
            g.Children.Add(cell);
        }
        _contentHost.Children.Add(g);
    }

    private int YearStart() => _viewYear / 12 * 12;

    private void ShiftBy(int delta)
    {
        if (_view == DpView.Days)
        {
            var m = _viewMonth + delta;
            if (m < 0) { _viewMonth = 11; _viewYear--; }
            else if (m > 11) { _viewMonth = 0; _viewYear++; }
            else _viewMonth = m;
        }
        else
        {
            _viewYear += delta * (_view == DpView.Years ? 12 : 1);
        }
        Rebuild();
    }

    private static Button MakeNavBtn(string glyph, string tip, Action onClick)
    {
        var btn = new Button
        {
            Content = new TextBlock { Text = glyph, FontSize = 16 },
            Background = null,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(8, 2, 8, 2)
        };
        ToolTipService.SetToolTip(btn, tip);
        btn.Click += (_, _) => onClick();
        return btn;
    }

    private static void AdvanceCell(ref int col, ref int row)
    {
        col++;
        if (col == 7) { col = 0; row++; }
    }
}
