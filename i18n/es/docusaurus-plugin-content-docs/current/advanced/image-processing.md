---
title: Procesamiento de Imágenes
sidebar_label: Procesamiento de Imágenes
---

# Procesamiento de Imágenes con ImageSharp

`ValiBlob.ImageSharp` integra el procesamiento de imágenes en el pipeline de subida usando `SixLabors.ImageSharp`. Permite redimensionar, convertir formatos, controlar la calidad JPEG/WebP, corregir orientación EXIF y generar miniaturas automáticamente.

## Instalación

```bash
dotnet add package ValiBlob.ImageSharp
```

## Activación en el pipeline

```csharp
using ValiBlob.ImageSharp;

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "aws")
    .AddProvider<AWSS3Provider>("aws", opts => { /* ... */ })
    .WithPipeline(p => p
        .UseContentTypeDetection()
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 20_000_000;
            v.AllowedContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        })
        .UseImageProcessing(img =>
        {
            img.MaxWidth = 2048;
            img.MaxHeight = 2048;
            img.OutputFormat = ImageOutputFormat.WebP;
            img.Quality = 85;
            img.AutoOrient = true;
            img.GenerateThumbnail = true;
            img.ThumbnailWidth = 200;
            img.ThumbnailHeight = 200;
            img.ThumbnailSuffix = "-thumb";
        })
    );
```

## ImageProcessingOptions

```csharp
public class ImageProcessingOptions
{
    /// <summary>Ancho máximo en píxeles. null = sin límite.</summary>
    public int? MaxWidth { get; set; }

    /// <summary>Alto máximo en píxeles. null = sin límite.</summary>
    public int? MaxHeight { get; set; }

    /// <summary>Formato de salida. null = mismo formato que la entrada.</summary>
    public ImageOutputFormat? OutputFormat { get; set; }

    /// <summary>Calidad de compresión (1-100). Solo aplica a JPEG y WebP. Por defecto: 80.</summary>
    public int Quality { get; set; } = 80;

    /// <summary>Aplicar rotación automática basada en metadatos EXIF. Por defecto: true.</summary>
    public bool AutoOrient { get; set; } = true;

    /// <summary>Generar una miniatura al subir. Por defecto: false.</summary>
    public bool GenerateThumbnail { get; set; } = false;

    /// <summary>Ancho de la miniatura en píxeles. Por defecto: 150.</summary>
    public int ThumbnailWidth { get; set; } = 150;

    /// <summary>Alto de la miniatura en píxeles. Por defecto: 150.</summary>
    public int ThumbnailHeight { get; set; } = 150;

    /// <summary>Sufijo para el nombre del archivo de miniatura. Por defecto: "-thumbnail".</summary>
    public string ThumbnailSuffix { get; set; } = "-thumbnail";

    /// <summary>Modo de redimensionado. Por defecto: Max.</summary>
    public ImageResizeMode ResizeMode { get; set; } = ImageResizeMode.Max;
}

public enum ImageOutputFormat { Jpeg, Png, WebP, Avif, Gif }

public enum ImageResizeMode
{
    /// <summary>Mantener proporción original, no superar MaxWidth × MaxHeight.</summary>
    Max,
    /// <summary>Recortar centralmente para llenar exactamente MaxWidth × MaxHeight.</summary>
    Crop,
    /// <summary>Rellenar con fondo para alcanzar exactamente MaxWidth × MaxHeight.</summary>
    Pad,
    /// <summary>Estirar sin mantener proporción (puede distorsionar).</summary>
    Stretch
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `MaxWidth` / `MaxHeight` | `null` | Dimensiones máximas en píxeles |
| `OutputFormat` | `null` (mismo que entrada) | Formato de salida: `Jpeg`, `Png`, `WebP`, `Avif`, `Gif` |
| `Quality` | `80` | Calidad de compresión para JPEG y WebP (1–100) |
| `AutoOrient` | `true` | Corregir orientación según metadatos EXIF |
| `ResizeMode` | `Max` | `Max`, `Crop`, `Pad`, `Stretch` |
| `GenerateThumbnail` | `false` | Generar un archivo de miniatura adicional |
| `ThumbnailWidth` / `ThumbnailHeight` | `150` | Dimensiones de la miniatura |
| `ThumbnailSuffix` | `-thumbnail` | Sufijo del archivo de miniatura |

## Ejemplos de configuración

### Avatares de usuario (cuadrados con recorte)

```csharp
.UseImageProcessing(img =>
{
    img.MaxWidth = 400;
    img.MaxHeight = 400;
    img.ResizeMode = ImageResizeMode.Crop;  // Recortar para cuadrado perfecto
    img.OutputFormat = ImageOutputFormat.WebP;
    img.Quality = 85;
    img.AutoOrient = true;
    img.GenerateThumbnail = true;
    img.ThumbnailWidth = 60;
    img.ThumbnailHeight = 60;
    img.ThumbnailSuffix = "-small";
})
```

Resultado para `avatares/user-123.jpg`:
- `avatares/user-123.webp` — 400×400 px, recortado
- `avatares/user-123-small.webp` — 60×60 px, miniatura

### Imágenes de producto (proporcional, sin recortar)

```csharp
.UseImageProcessing(img =>
{
    img.MaxWidth = 1920;
    img.MaxHeight = 1920;
    img.ResizeMode = ImageResizeMode.Max;  // Mantener proporción original
    img.OutputFormat = ImageOutputFormat.WebP;
    img.Quality = 90;
    img.GenerateThumbnail = true;
    img.ThumbnailWidth = 300;
    img.ThumbnailHeight = 300;
    img.ThumbnailSuffix = "-preview";
})
```

### Optimizar para web (solo conversión a WebP)

```csharp
.UseImageProcessing(img =>
{
    img.OutputFormat = ImageOutputFormat.WebP;
    img.Quality = 80;
    img.AutoOrient = true;
    img.MaxWidth = 2560;
    img.GenerateThumbnail = false;
})
```

## Ejemplo completo: API de avatares

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "s3")
    .AddProvider<AWSS3Provider>("s3", opts =>
    {
        opts.BucketName = "mi-app-imagenes";
        opts.Region = "us-east-1";
    })
    .WithPipeline(p => p
        .UseContentTypeDetection()
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 10_000_000;
            v.AllowedContentTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"];
        })
        .UseImageProcessing(img =>
        {
            img.MaxWidth = 400;
            img.MaxHeight = 400;
            img.ResizeMode = ImageResizeMode.Crop;
            img.OutputFormat = ImageOutputFormat.WebP;
            img.Quality = 85;
            img.AutoOrient = true;
            img.GenerateThumbnail = true;
            img.ThumbnailWidth = 60;
            img.ThumbnailHeight = 60;
            img.ThumbnailSuffix = "-thumb";
        })
        .UseConflictResolution(ConflictResolution.ReplaceExisting)
    );

app.MapPost("/api/usuarios/{usuarioId}/avatar", async (
    Guid usuarioId,
    IFormFile imagen,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    await using var stream = imagen.OpenReadStream();

    var resultado = await storage.UploadAsync(new UploadRequest
    {
        Path = $"avatares/{usuarioId}/avatar",
        Content = stream,
        ContentType = imagen.ContentType,
        KnownSize = imagen.Length
    }, ct);

    if (!resultado.IsSuccess)
    {
        return resultado.ErrorCode switch
        {
            StorageErrorCode.FileTooLarge => Results.Problem("Imagen demasiado grande.", statusCode: 413),
            StorageErrorCode.InvalidFileType => Results.Problem("Formato no soportado.", statusCode: 415),
            _ => Results.StatusCode(500)
        };
    }

    return Results.Ok(new
    {
        urlAvatar = resultado.Value!.Url,
        urlMiniatura = resultado.Value.ThumbnailUrl,
        tamanoBytes = resultado.Value.SizeBytes
    });
}).DisableAntiforgery().RequireAuthorization();
```

## Acceder a la miniatura generada

```csharp
var resultado = await storage.UploadAsync(request, ct);

if (resultado.IsSuccess && resultado.Value!.ThumbnailUrl is not null)
{
    // Guardar ambas URLs en la base de datos
    await db.Productos
        .Where(p => p.Id == productoId)
        .ExecuteUpdateAsync(s => s
            .SetProperty(p => p.ImagenUrl, resultado.Value.Url)
            .SetProperty(p => p.MiniaturaUrl, resultado.Value.ThumbnailUrl), ct);
}
```

## Formatos de entrada soportados

| Formato | Extensiones | Lectura |
|---|---|---|
| JPEG | `.jpg`, `.jpeg` | Sí |
| PNG | `.png` | Sí |
| WebP | `.webp` | Sí |
| GIF | `.gif` | Sí (primer frame) |
| BMP | `.bmp` | Sí |
| TIFF | `.tiff` | Sí |
| HEIC/HEIF | `.heic`, `.heif` | Sí (requiere plugin) |
| AVIF | `.avif` | Sí |

:::tip Consejo
WebP ofrece 25–34% menos tamaño que JPEG con la misma calidad visual percibida. Convierte las imágenes de los usuarios a WebP en el pipeline para reducir costos de almacenamiento y mejorar los tiempos de carga. Todos los navegadores modernos (Chrome, Firefox, Safari, Edge) soportan WebP.
:::

:::info Información
El procesamiento de imágenes ocurre en memoria en el servidor. Para imágenes muy grandes (más de 50 megapíxeles o archivos de más de 50 MB), considera procesar las imágenes de forma asíncrona con un worker separado (Azure Functions, AWS Lambda, un BackgroundService dedicado) para no bloquear el thread del request HTTP.
:::
