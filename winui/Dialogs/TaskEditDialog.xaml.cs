using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using System.Linq;
using WorkLog_WinUI.Models;

namespace WorkLog_WinUI.Dialogs;

/// <summary>子任务编辑行（双向绑定需要可变属性）</summary>
public class SubtaskRow
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public bool Done { get; set; }
}

/// <summary>任务编辑对话框：标题/正文/备注/子任务。保存时多天同步（对齐 updateTask）</summary>
public sealed partial class TaskEditDialog : ContentDialog
{
    private readonly string _date;
    private readonly TaskItem? _source; // null = 新建
    private readonly ObservableCollection<SubtaskRow> _subtasks = new();

    private TaskEditDialog(string date, TaskItem? task)
    {
        InitializeComponent();
        _date = date;
        _source = task;
        SubtaskList.ItemsSource = _subtasks;

        if (task is null)
        {
            DialogTitle.Text = $"新建任务 · {date}";
        }
        else
        {
            DialogTitle.Text = "编辑任务（所有天同步）";
            TitleBox.Text = task.Title;
            BodyBox.Text = task.Body;
            NoteBox.Text = task.Note;
            foreach (var s in task.Subtasks)
                _subtasks.Add(new SubtaskRow { Id = s.Id, Title = s.Title, Done = s.Done });
        }
    }

    public static TaskEditDialog Edit(string date, TaskItem task) => new(date, task);
    public static TaskEditDialog Create(string date) => new(date, null);

    private void AddSubtask_Click(object sender, RoutedEventArgs e)
    {
        _subtasks.Add(new SubtaskRow { Id = Guid.NewGuid().ToString(), Title = "", Done = false });
    }

    private void RemoveSubtask_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is SubtaskRow row)
            _subtasks.Remove(row);
    }

    private void OnPrimaryClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var title = TitleBox.Text.Trim();
        if (title.Length == 0) return;

        var subtasks = _subtasks
            .Where(r => r.Title.Trim().Length > 0)
            .Select(r => new Subtask { Id = r.Id, Title = r.Title.Trim(), Done = r.Done })
            .ToList();

        if (_source is null)
        {
            App.Data.CreateTaskFull(_date, title, BodyBox.Text, NoteBox.Text, subtasks);
        }
        else
        {
            App.Data.UpdateTask(_date, _source.Id, t =>
            {
                t.Title = title;
                t.Body = BodyBox.Text;
                t.Note = NoteBox.Text;
                t.Subtasks = subtasks;
            });
        }
    }
}
