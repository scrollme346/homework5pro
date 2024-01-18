using System;

class Shop : IDisposable
{
    public string Name { get; set; }
    public string Address { get; set; }
    public Shop.ShopType Type { get; set; } // Исправлено здесь

    public enum ShopType
    {
        Grocery,
        Household,
        Clothing,
        Footwear
    }

    public Shop(string name, string address, ShopType type)
    {
        Name = name;
        Address = address;
        Type = type;
        Console.WriteLine($"Создан новый магазин типа {Type}: {Name}, расположен по адресу {Address}");
    }

    public void DisplayInfo()
    {
        Console.WriteLine($"Название магазина: {Name}");
        Console.WriteLine($"Адрес: {Address}");
        Console.WriteLine($"Тип: {Type}");
    }

    private bool disposed = false;

    protected virtual void Dispose(bool disposing)
    {
        if (!disposed)
        {
            if (disposing)
            {
                Console.WriteLine($"Освобождение ресурсов для магазина типа {Type}: {Name}");
            }

            disposed = true;
        }
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    ~Shop()
    {
        Dispose(false);
    }
}

class Program
{
    static void Main()
    {
        using (var groceryShop = new Shop("Супермаркет", "123 Главная улица", Shop.ShopType.Grocery))
        {
            groceryShop.DisplayInfo();
        }

        
    }
}

