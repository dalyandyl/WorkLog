using Microsoft.UI.Xaml;
using WorkLog_WinUI.Services;

namespace WorkLog_WinUI;

/// <summary>
/// 应用入口。持有主窗口与共享数据服务的静态引用，供各页面访问。
/// </summary>
public partial class App : Application
{
    public static MainWindow? MainWin { get; private set; }
    public static DataStore Data { get; } = new();

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
    {
        MainWin = new MainWindow();
        MainWin.Activate();

        // 应用 WinUI 版保存的主题与窗口材质（默认：跟随系统 + Mica）
        MainWin.ApplyTheme(Pages.SettingsPage.Current.Theme switch
        {
            "light" => ElementTheme.Light,
            "dark" => ElementTheme.Dark,
            _ => ElementTheme.Default
        });
        Pages.SettingsPage.ApplyBackdrop(MainWin, Pages.SettingsPage.Current.Backdrop);
    }
}
