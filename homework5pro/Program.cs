using System;

class Play
{
    public string Title { get; set; }
    public string Author { get; set; }
    public string Genre { get; set; }
    public int Year { get; set; }

    public Play(string title, string author, string genre, int year)
    {
        Title = title;
        Author = author;
        Genre = genre;
        Year = year;
    }

    public void DisplayInformation()
    {
        Console.WriteLine($"Title: {Title}");
        Console.WriteLine($"Author: {Author}");
        Console.WriteLine($"Genre: {Genre}");
        Console.WriteLine($"Year: {Year}");
    }

    ~Play()
    {
        Console.WriteLine($"Object {Title} destroyed");
    }
}

class Program
{
    static void Main()
    {
        Play myPlay = new Play("Titanic", "James Cameron", "Drama", 1997);
        myPlay.DisplayInformation();

        Console.ReadLine();
    }
}
