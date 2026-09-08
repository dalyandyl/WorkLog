using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Diagnostics;
using System.IO;
using WorkLog_WinUI.Services;

namespace WorkLog_WinUI.Pages;

public sealed partial class SettingsPage : Page
{
    public SettingsPage()
    {
        InitializeComponent();

        DataDirText.Text = App.Data.Root;

        foreach (var item in ThemeGroup.Items)
            if (item is RadioButton rb && (rb.Tag as string) == SettingsPersistence.Theme)
                rb.IsChecked = true;

        foreach (var item in BackdropGroup.Items)
            if (item is RadioButton rb && (rb.Tag as string) == SettingsPersistence.Backdrop)
                rb.IsChecked = true;

        foreach (var item in SourceGroup.Items)
        {
            if (item is RadioButton rb && (rb.Tag as string) == (SettingsPersistence.DataDir ?? "auto"))
                rb.IsChecked = true;
        }
    }

    private void ThemeGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is RadioButtons group && group.SelectedItem is RadioButton rb && rb.Tag is string tag)
        {
            SettingsPersistence.Mutate(s => s.Theme = tag);
            App.MainWin?.ApplyTheme(tag switch
            {
                "light" => ElementTheme.Light,
                "dark" => ElementTheme.Dark,
                _ => ElementTheme.Default
            });
        }
    }

    private void BackdropGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is RadioButtons group && group.SelectedItem is RadioButton rb && rb.Tag is string tag)
        {
            SettingsPersistence.Mutate(s => s.Backdrop = tag);
            ApplyBackdrop(App.MainWin, tag);
        }
    }

    /// <summary>切换数据源后刷新路径显示（各页面下次进入时生效）</summary>
    private void SourceGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is RadioButtons group && group.SelectedItem is RadioButton rb && rb.Tag is string tag)
        {
            App.Data.SwitchRoot(tag);
            DataDirText.Text = App.Data.Root;
        }
    }

    internal static void ApplyBackdrop(MainWindow? win, string backdrop)
    {
        if (win == null) return;
        win.SystemBackdrop = backdrop switch
        {
            "acrylic" => new DesktopAcrylicBackdrop(),
            "mica" => new MicaBackdrop(),
            _ => null
        };
    }

    private void OpenDirBtn_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(App.Data.Root);
        Process.Start(new ProcessStartInfo("explorer.exe", App.Data.Root) { UseShellExecute = true });
    }
}
