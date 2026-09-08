using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace WorkLog_WinUI.Pages;

public sealed partial class StatsPage : Page
{
    public StatsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => LoadStats();
    }

    private void LoadStats()
    {
        var dates = App.Data.ListDatesWithTasks();
        var total = 0;
        var done = 0;
        foreach (var d in dates)
        {
            var tasks = App.Data.ReadTasks(d);
            total += tasks.Count;
            done += tasks.Count(t => t.Done);
        }

        DaysText.Text = dates.Count.ToString();
        TotalText.Text = total.ToString();
        DoneText.Text = done.ToString();
        RateText.Text = total > 0 ? $"{done * 100 / total}%" : "—";
        EmptyHint.Visibility = total == 0 ? Visibility.Visible : Visibility.Collapsed;
    }
}
