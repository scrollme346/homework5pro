using System;

class Play : IDisposable
{
    public string Title { get; set; }
    public string AuthorFullName { get; set; }
    public string Genre { get; set; }
    public int Year { get; set; }

    public Play(string title, string authorFullName, string genre, int year)
    {
        Title = title;
        AuthorFullName = authorFullName;
        Genre = genre;
        Year = year;
    }

    public void DisplayInformation()
    {
        Console.WriteLine($"Title: {Title}");
        Console.WriteLine($"Author: {AuthorFullName}");
        Console.WriteLine($"Genre: {Genre}");
        Console.WriteLine($"Year: {Year}");
    }

    public void Dispose()
    {
        Console.WriteLine($"Disposing resources for the play: {Title}");
        
    }

    ~Play()
    {
        Console.WriteLine($"Destructing the play object: {Title}");
        Dispose();
    }
}

class Program
{
    static void Main()
    {
        using (Play hamlet = new Play("Hamlet", "William Shakespeare", "Tragedy", 1603))
        {
            hamlet.DisplayInformation();
            
        }  
    }
}
