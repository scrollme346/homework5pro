using System;

public class Shop : IDisposable
{
    private bool disposed = false;

    public string Name { get; set; }
    public string Address { get; set; }
    public ShopType Type { get; set; }

    public Shop(string name, string address, ShopType type)
    {
        Name = name;
        Address = address;
        Type = type;
    }

    public void DisplayInfo()
    {
        Console.WriteLine($"Назва: {Name}");
        Console.WriteLine($"Адреса: {Address}");
        Console.WriteLine($"Тип: {Type}");
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!disposed)
        {
            if (disposing)
            {
                // Викликати методи для вивільнення управляючих ресурсів
                Console.WriteLine($"Магазин {Name} закритий.");
            }

            disposed = true;
        }
    }

    ~Shop()
    {
        Dispose(false);
    }
}

public enum ShopType
{
    Grocery,
    Household,
    Clothing,
    Footwear
}

class Program
{
    static void Main()
    {
        using (var groceryShop = new Shop("Продуктовий магазин", "вул. Продовольча, 123", ShopType.Grocery))
        {
            groceryShop.DisplayInfo();

            
        } 

        Console.ReadLine();
    }
}
