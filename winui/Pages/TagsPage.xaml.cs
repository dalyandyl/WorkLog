using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Collections.ObjectModel;
using Windows.UI;

namespace WorkLog_WinUI.Pages;

/// <summary>标签色块（绑定用）</summary>
public record TagChip(string Name, Color Color);

public sealed partial class TagsPage : Page
{
    private readonly ObservableCollection<TagChip> _chips = new();

    public TagsPage()
    {
        InitializeComponent();
        TagWall.ItemsSource = _chips;
        Loaded += (_, _) => LoadTags();
    }

    private void LoadTags()
    {
        _chips.Clear();
        foreach (var tag in App.Data.ReadTags())
            _chips.Add(new TagChip(tag.Name, DayPage.ParseHex(tag.Color)));

        EmptyState.Visibility = _chips.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }
}
