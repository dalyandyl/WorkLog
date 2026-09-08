using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;

namespace WorkLog_WinUI.Pages;

/// <summary>回收站行视图模型</summary>
public record TrashRow(string Id, string Title, string Detail);

public sealed partial class TrashPage : Page
{
    private readonly ObservableCollection<TrashRow> _rows = new();

    public TrashPage()
    {
        InitializeComponent();
        TrashList.ItemsSource = _rows;
        Loaded += (_, _) => LoadTrash();
    }

    private void LoadTrash()
    {
        _rows.Clear();
        var items = App.Data.ListTrash();
        foreach (var it in items)
        {
            var days = it.Tasks.Count == 1 ? it.Tasks[0].Date : $"{it.Tasks.Count} 天";
            var deleted = ParseIsoLocal(it.DeletedAt);
            _rows.Add(new TrashRow(
                it.Id,
                it.Title,
                $"{days} · 删除于 {deleted:MM-dd HH:mm}"));
        }

        TitleText.Text = $"回收站 · {_rows.Count} 条";
        SummaryText.Text = _rows.Count > 0 ? "恢复会写回原日期；彻底删除不可恢复" : "";
        EmptyState.Visibility = _rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TrashList.Visibility = _rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        ClearBtn.IsEnabled = _rows.Count > 0;
    }

    private void RestoreBtn_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is string id)
        {
            App.Data.RestoreTrashItem(id);
            LoadTrash();
        }
    }

    private void RemoveBtn_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is string id)
        {
            App.Data.RemoveTrashItem(id);
            LoadTrash();
        }
    }

    private async void ClearBtn_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new ContentDialog
        {
            Title = "清空回收站",
            Content = "所有条目将被永久删除，此操作不可恢复。确定继续吗？",
            PrimaryButtonText = "清空",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot
        };
        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            App.Data.ClearTrash();
            LoadTrash();
        }
    }

    internal static DateTime ParseIsoLocal(string iso)
    {
        if (DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out var d))
            return d.ToLocalTime();
        return DateTime.MinValue;
    }
}
