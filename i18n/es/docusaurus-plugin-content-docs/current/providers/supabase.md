---
title: Supabase Storage
sidebar_label: Supabase Storage
---

# Proveedor Supabase Storage

`ValiBlob.Supabase` proporciona integración con Supabase Storage, la solución de almacenamiento de archivos de la plataforma Supabase. Ideal para proyectos que ya usan Supabase como backend, ya que permite aprovechar las políticas RLS y la autenticación integrada.

## Instalación

```bash
dotnet add package ValiBlob.Supabase
```

## SupabaseStorageOptions

```csharp
public class SupabaseStorageOptions
{
    public required string Url { get; set; }         // https://xxx.supabase.co
    public required string ServiceKey { get; set; }  // service_role key (NO el anon key)
    public required string BucketName { get; set; }  // Nombre del bucket
    public bool IsPublic { get; set; } = false;      // ¿Bucket de acceso público?
    public int TimeoutSeconds { get; set; } = 300;
}
```

### Tabla de opciones

| Opción | Por defecto | Descripción |
|---|---|---|
| `Url` | — | URL del proyecto Supabase (`https://xxx.supabase.co`). Requerida. |
| `ServiceKey` | — | `service_role` key del proyecto. Requerida. NUNCA usar el `anon` key. |
| `BucketName` | — | Nombre del bucket de almacenamiento. Requerido. |
| `IsPublic` | `false` | Si `true`, el bucket permite acceso público por URL directa. |
| `TimeoutSeconds` | `300` | Timeout para operaciones de almacenamiento. |

## Obtener las credenciales

1. Ve a tu proyecto en [supabase.com](https://supabase.com)
2. Ir a **Project Settings** → **API**
3. Copiar la **URL del proyecto** y el **service_role secret** (NO el `anon` key)

:::warning Advertencia
Usa siempre el `service_role` key en el backend, nunca el `anon` key. El `service_role` key bypasea las políticas RLS de Supabase y tiene acceso completo al almacenamiento: es adecuado para operaciones del servidor. El `anon` key está diseñado para el cliente y respeta las políticas RLS.
:::

## Configuración básica

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "supabase")
    .AddProvider<SupabaseStorageProvider>("supabase", opts =>
    {
        opts.Url = builder.Configuration["Supabase:Url"]!;
        opts.ServiceKey = builder.Configuration["Supabase:ServiceKey"]!;
        opts.BucketName = "documentos";
        opts.IsPublic = false;
    });
```

```json
{
  "Supabase": {
    "Url": "https://miproyecto.supabase.co",
    "BucketName": "documentos"
  }
}
```

```bash
# ServiceKey en User Secrets (nunca en appsettings.json)
dotnet user-secrets set "Supabase:ServiceKey" "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
dotnet user-secrets set "Supabase:Url" "https://miproyecto.supabase.co"
```

## Buckets: público vs privado

### Bucket privado (por defecto)

```csharp
opts.IsPublic = false; // Solo accesible con service_role key o URLs firmadas
```

Los archivos en buckets privados:
- No son accesibles directamente por URL pública
- Requieren una URL firmada para compartir con terceros
- Respetan las políticas RLS de Supabase

### Bucket público

```csharp
opts.IsPublic = true; // Cualquiera puede acceder con la URL directa
```

Los archivos en buckets públicos:
- Tienen una URL pública directa sin autenticación
- Son adecuados para activos estáticos: imágenes de producto, logos, documentos abiertos
- No requieren autenticación para lectura

## Crear el bucket

```sql
-- Desde el SQL Editor de Supabase
INSERT INTO storage.buckets (id, name, public)
VALUES ('documentos', 'documentos', false);
```

O desde el dashboard: **Storage** → **New bucket**.

## Políticas RLS del bucket

```sql
-- Permitir a usuarios autenticados leer sus propios archivos
CREATE POLICY "Leer archivos propios"
ON storage.objects FOR SELECT
TO authenticated
USING (auth.uid() = owner);

-- Permitir a usuarios autenticados subir en su carpeta
CREATE POLICY "Subir en carpeta propia"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'documentos' AND
    (storage.foldername(name))[1] = auth.uid()::text
);

-- Permitir eliminación solo de archivos propios
CREATE POLICY "Eliminar archivos propios"
ON storage.objects FOR DELETE
TO authenticated
USING (auth.uid() = owner);
```

## URLs firmadas (Signed URLs)

```csharp
if (storage is IPresignedUrlProvider presigned)
{
    // URL válida por 60 minutos
    var resultado = await presigned.GetPresignedDownloadUrlAsync(
        path: $"{userId}/documento-privado.pdf",
        expiry: TimeSpan.FromHours(1),
        ct);

    if (resultado.IsSuccess)
    {
        return Results.Ok(new
        {
            urlFirmada = resultado.Value,
            expiraEn = DateTime.UtcNow.AddHours(1)
        });
    }
}
```

## Múltiples buckets con múltiples proveedores

```csharp
builder.Services
    .AddValiBlob(o => o.DefaultProvider = "supabase-privado")
    .AddProvider<SupabaseStorageProvider>("supabase-privado", opts =>
    {
        opts.Url = config["Supabase:Url"]!;
        opts.ServiceKey = config["Supabase:ServiceKey"]!;
        opts.BucketName = "documentos-privados";
        opts.IsPublic = false;
    })
    .AddProvider<SupabaseStorageProvider>("supabase-publico", opts =>
    {
        opts.Url = config["Supabase:Url"]!;
        opts.ServiceKey = config["Supabase:ServiceKey"]!;
        opts.BucketName = "imagenes-producto";
        opts.IsPublic = true;
    });
```

## Ejemplo completo

```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddValiBlob(o => o.DefaultProvider = "supabase")
    .AddProvider<SupabaseStorageProvider>("supabase", opts =>
    {
        opts.Url = builder.Configuration["Supabase:Url"]!;
        opts.ServiceKey = builder.Configuration["Supabase:ServiceKey"]!;
        opts.BucketName = builder.Configuration["Supabase:BucketName"] ?? "uploads";
        opts.IsPublic = false;
    })
    .WithPipeline(p => p
        .UseValidation(v =>
        {
            v.MaxFileSizeBytes = 50_000_000; // 50 MB (límite del free tier de Supabase)
            v.AllowedExtensions = [".jpg", ".jpeg", ".png", ".pdf", ".docx"];
        })
        .UseContentTypeDetection()
        .UseConflictResolution(ConflictResolution.RenameWithSuffix)
    );

var app = builder.Build();

// Subir archivo del usuario autenticado
app.MapPost("/api/archivos", async (
    IFormFile archivo,
    ClaimsPrincipal usuario,
    IStorageProvider storage,
    CancellationToken ct) =>
{
    var userId = usuario.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var ruta = StoragePath.From(userId, StoragePath.Sanitize(archivo.FileName));

    await using var stream = archivo.OpenReadStream();
    var resultado = await storage.UploadAsync(new UploadRequest
    {
        Path = ruta,
        Content = stream,
        ContentType = archivo.ContentType,
        KnownSize = archivo.Length,
        Metadata = new Dictionary<string, string>
        {
            ["usuario-id"] = userId,
            ["nombre-original"] = archivo.FileName
        }
    }, ct);

    return resultado.IsSuccess
        ? Results.Created($"/api/archivos/{resultado.Value!.Path}",
            new { ruta = resultado.Value.Path, url = resultado.Value.Url })
        : Results.BadRequest(resultado.ErrorMessage);
}).RequireAuthorization();
```

:::tip Consejo
Supabase Storage es ideal para proyectos que ya usan Supabase como backend. Centralizar el almacenamiento en Supabase simplifica la infraestructura, reduce costos y permite aprovechar las políticas RLS para control de acceso granular a los archivos sin infraestructura adicional.
:::
