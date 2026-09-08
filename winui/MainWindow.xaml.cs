using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using WorkLog_WinUI.Pages;

namespace WorkLog_WinUI;

/// <summary>
/// 主窗口：NavigationView 分组导航（对齐 Electron 版 NAV_ITEMS），
/// Mica 背景 + 自定义标题栏 + 跟随系统主题/强调色（WinUI 默认行为）。
/// </summary>
public sealed partial class MainWindow : Window
{
    private static readonly Dictionary<string, Type> Pages = new()
    {
        ["day"] = typeof(DayPage),
        ["week"] = typeof(WeekPage),
        ["publish"] = typeof(PublishPage),
        ["stats"] = typeof(StatsPage),
        ["report"] = typeof(ReportPage),
        ["tags"] = typeof(TagsPage),
        ["meeting"] = typeof(MeetingPage),
        ["trash"] = typeof(TrashPage),
        ["settings"] = typeof(SettingsPage)
    };

    public Frame Frame => RootFrame;

    public MainWindow()
    {
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.SetIcon("Assets/AppIcon.ico");

        RootFrame.Navigate(typeof(DayPage));
    }

    private void Nav_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem item && item.Tag is string tag
            && Pages.TryGetValue(tag, out var page))
        {
            if (RootFrame.Content?.GetType() != page)
                RootFrame.Navigate(page);
        }
    }

    /// <summary>应用主题（设置页调用）：System=跟随系统</summary>
    public void ApplyTheme(ElementTheme theme) => RootGrid.RequestedTheme = theme;
}
