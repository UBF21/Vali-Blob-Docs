---
title: StoragePath
sidebar_label: StoragePath
---

# StoragePath

`StoragePath` es una clase de utilidad estática para construir, manipular y normalizar rutas de almacenamiento de forma segura. Evita errores comunes como barras duplicadas, caracteres especiales problemáticos en URLs, y protege contra ataques de path traversal cuando se procesan nombres de archivo proporcionados por usuarios.

## Construcción básica con From()

```csharp
// Ruta de dos segmentos
string ruta = StoragePath.From("avatares", "usuario-123.jpg");
// Resultado: "avatares/usuario-123.jpg"

// Ruta con múltiples segmentos
string ruta = StoragePath.From("tenants", "acme", "documentos", "contrato.pdf");
// Resultado: "tenants/acme/documentos/contrato.pdf"

// Desde una sola cadena (normaliza separadores)
string ruta = StoragePath.From("subidas/2024/enero/factura.pdf");
// Resultado: "subidas/2024/enero/factura.pdf"

// Con segmentos que tienen barras (se normaliza)
string ruta = StoragePath.From("archivos/", "/2024/", "//reporte.pdf");
// Resultado: "archivos/2024/reporte.pdf"
```

## Métodos helper de prefijo y sufijo

### WithDatePrefix

Agrega un prefijo con la fecha actual en formato `AAAA/MM/DD`:

```csharp
var ruta = StoragePath.From("subidas", "factura.pdf").WithDatePrefix();
// Resultado: "2024/03/15/subidas/factura.pdf"
```

Útil para organizar archivos cronológicamente y facilitar el listado y limpieza por períodos.

### WithTimestampPrefix

Agrega un prefijo con timestamp Unix en milisegundos:

```csharp
var ruta = StoragePath.From("subidas", "foto.jpg").WithTimestampPrefix();
// Resultado: "1710518400000/subidas/foto.jpg"
```

Garantiza unicidad de rutas sin posibilidad de colisiones temporales.

### WithHashSuffix

Agrega un sufijo con los primeros 8 caracteres del hash SHA-256 del contenido:

```csharp
await using var stream = File.OpenRead("documento.pdf");
var ruta = await StoragePath.From("docs", "documento.pdf").WithHashSuffixAsync(stream, ct);
// Resultado: "docs/documento_a3f8c2d1.pdf"
```

:::note Nota
`WithHashSuffixAsync` lee el stream para calcular el hash y luego lo rebobina automáticamente. El stream debe soportar `Seek`. Para streams que no soporten seek (como `NetworkStream`), copia el contenido a un `MemoryStream` primero.
:::

### WithRandomSuffix

Agrega un sufijo aleatorio de 8 caracteres hexadecimales:

```csharp
var ruta = StoragePath.From("temporal", "archivo.txt").WithRandomSuffix();
// Resultado: "temporal/archivo_4a2f9b1c.txt"
```

Ideal cuando necesitas unicidad rápida sin leer el contenido del archivo.

## Sanitización

### Sanitize

Limpia una cadena para hacerla segura como segmento de ruta de almacenamiento:

```csharp
var nombre = StoragePath.Sanitize("Mi Archivo con Espacios & Caracteres Especiales!.pdf");
// Resultado: "mi-archivo-con-espacios-caracteres-especiales.pdf"
```

Reglas de sanitización aplicadas en orden:

1. Convertir a minúsculas
2. Reemplazar espacios con guiones `-`
3. Eliminar caracteres `&`, `#`, `?`, `=`, `+`, `%`, `@`, `!`
4. Eliminar caracteres no ASCII
5. Reemplazar múltiples guiones consecutivos por uno solo
6. Eliminar guiones al inicio y al final

## Manipulación de rutas

### Combine

Combina múltiples segmentos normalizando separadores y eliminando duplicados:

```csharp
var ruta = StoragePath.Combine("tenants/acme/", "/documentos/", "//reporte.pdf");
// Resultado: "tenants/acme/documentos/reporte.pdf"
```

### GetFileName

Obtiene el nombre del archivo desde una ruta completa:

```csharp
var nombre = StoragePath.GetFileName("subidas/2024/foto.jpg");
// Resultado: "foto.jpg"
```

### GetDirectory

Obtiene el directorio (prefijo) de una ruta:

```csharp
var directorio = StoragePath.GetDirectory("subidas/2024/foto.jpg");
// Resultado: "subidas/2024"
```

### GetExtension

Obtiene la extensión de archivo:

```csharp
var extension = StoragePath.GetExtension("subidas/2024/foto.jpg");
// Resultado: ".jpg"
```

## Tabla de ejemplos de transformación

| Entrada | Método | Resultado |
|---|---|---|
| `"subidas", "foto.jpg"` | `From()` | `"subidas/foto.jpg"` |
| `"subidas/foto.jpg"` | `WithDatePrefix()` | `"2024/03/15/subidas/foto.jpg"` |
| `"subidas/foto.jpg"` | `WithTimestampPrefix()` | `"1710518400000/subidas/foto.jpg"` |
| `"subidas/foto.jpg"` | `WithRandomSuffix()` | `"subidas/foto_4a2f9b1c.jpg"` |
| `"Mi Foto 2024!.jpg"` | `Sanitize()` | `"mi-foto-2024.jpg"` |
| `"archivos/../secreto.txt"` | `Validate()` | Lanza excepción (path traversal) |

## Validación

`StoragePath.Validate` lanza `InvalidStoragePathException` si la ruta es inválida. `StoragePath.IsValid` retorna un `bool`:

```csharp
// Lanza InvalidStoragePathException
StoragePath.Validate("subidas/../../../etc/passwd"); // ❌ Path traversal detectado
StoragePath.Validate("");                            // ❌ Ruta vacía
StoragePath.Validate("/etc/passwd");                 // ❌ Ruta absoluta

// Retorna bool sin lanzar excepción
bool esValida = StoragePath.IsValid("subidas/foto.jpg");  // true
bool esValida = StoragePath.IsValid("../secretos");        // false
bool esValida = StoragePath.IsValid("");                   // false
```

Condiciones que hacen inválida una ruta:
- Ruta vacía o compuesta solo de espacios
- Intentos de path traversal con `..`
- Rutas absolutas (comenzando con `/` o unidades de disco como `C:\`)
- Caracteres nulos (`\0`)

## Casos de uso comunes

### Avatares de usuario con sufijo aleatorio

```csharp
public string GenerarRutaAvatar(Guid usuarioId, string extension)
{
    return StoragePath
        .From("avatares", usuarioId.ToString(), $"avatar{extension}")
        .WithRandomSuffix();
    // Resultado: "avatares/550e8400-e29b-41d4-a716-446655440000/avatar_3f2a1b4c.jpg"
}
```

### Documentos por tenant organizados por fecha

```csharp
public string GenerarRutaDocumento(string tenantId, string categoria, string nombreArchivo)
{
    var nombreSeguro = StoragePath.Sanitize(nombreArchivo);
    return StoragePath
        .From("tenants", tenantId, categoria, nombreSeguro)
        .WithDatePrefix();
    // Resultado: "2024/03/15/tenants/acme/facturas/factura-marzo-2024.pdf"
}
```

### Archivos temporales con timestamp para limpieza automatizada

```csharp
public string GenerarRutaTemporal(string nombreArchivo)
{
    return StoragePath.From("temporal", StoragePath.Sanitize(nombreArchivo))
                      .WithTimestampPrefix();
    // Un job nocturno puede eliminar archivos cuyo timestamp sea mayor a 24 horas
    // Resultado: "1710518400000/temporal/reporte-borrador.xlsx"
}
```

### Nombres de archivo seguros desde entrada del usuario

```csharp
app.MapPost("/subir", async (IFormFile archivo, IStorageProvider storage, CancellationToken ct) =>
{
    // Nunca usar archivo.FileName directamente en la ruta
    var extension = Path.GetExtension(archivo.FileName).ToLowerInvariant();
    var nombreBase = StoragePath.Sanitize(Path.GetFileNameWithoutExtension(archivo.FileName));
    var ruta = StoragePath.From("subidas", $"{nombreBase}{extension}").WithTimestampPrefix();

    // Ahora la ruta es segura para usar en el almacenamiento
    var resultado = await storage.UploadAsync(new UploadRequest
    {
        Path = ruta,
        Content = archivo.OpenReadStream(),
        ContentType = archivo.ContentType
    }, ct);

    return resultado.IsSuccess ? Results.Ok(ruta) : Results.BadRequest();
}).DisableAntiforgery();
```

## Caracteres y su tratamiento

| Carácter | ¿Permitido en rutas? | Notas |
|---|---|---|
| `a-z`, `A-Z`, `0-9` | Sí | Siempre seguros |
| `-`, `_`, `.` | Sí | Seguros para rutas y URLs |
| `/` | Sí | Separador de segmento |
| Espacios | Necesita sanitizar | Usar `Sanitize()` para convertir a `-` |
| `&`, `?`, `#`, `=`, `+` | No | Problemáticos en URLs — eliminar con `Sanitize()` |
| `..` | No | Path traversal — lanza excepción |
| `\` | Normalizado | Se convierte automáticamente a `/` |
| Caracteres no ASCII | Necesita sanitizar | Eliminar con `Sanitize()` |
| `\0` | No | Carácter nulo — lanza excepción |

:::tip Consejo
Aplica siempre `StoragePath.Sanitize()` a los nombres de archivo proporcionados por usuarios finales antes de construir rutas. Esto previene tanto errores técnicos (caracteres inválidos para el proveedor) como posibles ataques de path traversal o inyección de rutas.
:::

:::warning Advertencia
`StoragePath.From()` no sanitiza automáticamente los segmentos de entrada — solo normaliza los separadores. Si los segmentos provienen de entrada del usuario, aplica `Sanitize()` explícitamente a cada uno antes de pasarlos a `From()`.
:::
