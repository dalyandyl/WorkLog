using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace WorkLog_WinUI.Pages;

public sealed partial class SettingsPage : Page
{
    // WinUI 版独立设置（不写 Electron 版的 settings.json，避免互相干扰）
    public sealed class WinUiSettings
    {
        public string Theme { get; set; } = "system";
        public string Backdrop { get; set; } = "mica";
    }

    private static readonly string SettingsFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "WorkLog", "winui-settings.json");

    public static WinUiSettings Current { get; } = Load();

    public SettingsPage()
    {
        InitializeComponent();

        DataDirText.Text = App.Data.Root;

        foreach (var item in ThemeGroup.Items)
            if (item is RadioButton rb && (rb.Tag as string) == Current.Theme)
                rb.IsChecked = true;

        foreach (var item in BackdropGroup.Items)
            if (item is RadioButton rb && (rb.Tag as string) == Current.Backdrop)
                rb.IsChecked = true;
    }

    private static WinUiSettings Load()
    {
        try
        {
            if (File.Exists(SettingsFile))
                return JsonSerializer.Deserialize<WinUiSettings>(File.ReadAllText(SettingsFile)) ?? new();
        }
        catch { }
        return new();
    }

    private static void Save() 
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsFile)!);
            File.WriteAllText(SettingsFile, JsonSerializer.Serialize(Current, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { }
    }

    private void ThemeGroup_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is RadioButtons group && group.SelectedItem is RadioButton rb && rb.Tag is string tag)
        {
            Current.Theme = tag;
            Save();
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
            Current.Backdrop = tag;
            Save();
            ApplyBackdrop(App.MainWin, tag);
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
