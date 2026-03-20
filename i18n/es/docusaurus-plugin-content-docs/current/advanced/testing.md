---
title: Pruebas
sidebar_label: Pruebas
---

# Pruebas con ValiBlob

`ValiBlob.Testing` proporciona un `InMemoryStorageProvider` que permite escribir pruebas unitarias y de integración sin necesidad de infraestructura real de almacenamiento en la nube. Es rápido, determinista y no requiere ninguna cuenta ni credencial externa.

## Instalación

```bash
dotnet add package ValiBlob.Testing
```

## InMemoryStorageProvider

```csharp
public class InMemoryStorageProvider : IStorageProvider, IResumableStorageProvider
{
    // Estado inspectable directamente en las pruebas
    public IReadOnlyDictionary<string, InMemoryFile> Files { get; }
    public int FileCount => Files.Count;

    // Limpieza entre pruebas
    public void Clear();

    // Verificar existencia en el estado interno
    public bool Contains(string path);

    // Obtener contenido como bytes
    public byte[]? GetContent(string path);

    // Obtener metadatos del estado interno
    public FileMetadata? GetMetadata(string path);
}

public class InMemoryFile
{
    public string Path { get; init; }
    public byte[] Content { get; init; }
    public string? ContentType { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public Dictionary<string, string> CustomMetadata { get; init; }
    public IReadOnlyList<string> Tags { get; init; }
}
```

Al implementar tanto `IStorageProvider` como `IResumableStorageProvider`, el proveedor en memoria cubre todos los escenarios de prueba, incluyendo subidas reanudables por fragmentos.

## Configuración en pruebas

### Con xUnit

```csharp
public class PruebasServicioDocumentos : IDisposable
{
    private readonly InMemoryStorageProvider _storage;
    private readonly ServicioDocumentos _servicio;

    public PruebasServicioDocumentos()
    {
        _storage = new InMemoryStorageProvider();

        // El servicio a probar recibe el proveedor en memoria
        _servicio = new ServicioDocumentos(_storage);
    }

    [Fact]
    public async Task SubirDocumento_DebeAlmacenarEnStorage()
    {
        // Arrange
        var contenido = "Contenido del documento"u8.ToArray();
        using var stream = new MemoryStream(contenido);

        // Act
        var resultado = await _servicio.SubirDocumentoAsync(
            stream, "mi-documento.txt", "usuario-1", CancellationToken.None);

        // Assert
        Assert.NotNull(resultado);
        Assert.True(_storage.Contains(resultado.Path));
        Assert.Equal(contenido, _storage.GetContent(resultado.Path));
    }

    public void Dispose() => _storage.Clear();
}
```

### Con DI de pruebas (WebApplicationFactory)

```csharp
public class PruebasApiStorage : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public PruebasApiStorage(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Reemplazar el proveedor real con el proveedor en memoria
                services.AddValiBlob(o => o.DefaultProvider = "test")
                        .AddProvider<InMemoryStorageProvider>("test");

                // O directamente reemplazar el IStorageProvider registrado:
                var descriptor = services.FirstOrDefault(
                    d => d.ServiceType == typeof(IStorageProvider));
                if (descriptor != null)
                    services.Remove(descriptor);

                var storage = new InMemoryStorageProvider();
                services.AddSingleton<IStorageProvider>(storage);
                services.AddSingleton(storage); // Para acceder al estado en las pruebas
            });
        });
    }

    [Fact]
    public async Task POST_Subir_DebeRetornar201()
    {
        // Arrange
        var client = _factory.CreateClient();
        var contenido = new MultipartFormDataContent();
        contenido.Add(
            new StreamContent(new MemoryStream("hola mundo"u8.ToArray())),
            "archivo",
            "prueba.txt");

        // Act
        var response = await client.PostAsync("/api/subir", contenido);

        // Assert
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        // Verificar en el estado interno del proveedor
        var storage = _factory.Services.GetRequiredService<InMemoryStorageProvider>();
        Assert.Equal(1, storage.FileCount);
    }
}
```

## Patrones de prueba comunes

### Verificar que el archivo fue subido

```csharp
[Fact]
public async Task Subida_ArchivoDebeExistirEnStorage()
{
    var storage = new InMemoryStorageProvider();
    var servicio = new MiServicio(storage);

    await servicio.ProcessarYSubirAsync(GetTestStream(), "test.pdf", CancellationToken.None);

    Assert.True(storage.Contains("documentos/test.pdf"));
    var archivo = storage.Files["documentos/test.pdf"];
    Assert.Equal("application/pdf", archivo.ContentType);
}
```

### Verificar metadatos

```csharp
[Fact]
public async Task Subida_DebeIncluirMetadatosCorrectos()
{
    var storage = new InMemoryStorageProvider();
    var servicio = new ServicioFacturas(storage);

    await servicio.SubirFacturaAsync(123, GetFacturaStream(), CancellationToken.None);

    var meta = storage.GetMetadata("facturas/123.pdf");
    Assert.NotNull(meta);
    Assert.Equal("123", meta.CustomMetadata["factura-id"]);
    Assert.Equal("pendiente", meta.CustomMetadata["estado"]);
}
```

### Probar error cuando el archivo no existe

```csharp
[Fact]
public async Task Descargar_ArchivoInexistente_DebeRetornarNotFound()
{
    var storage = new InMemoryStorageProvider();
    // Sin subir ningún archivo

    var resultado = await storage.DownloadAsync(new DownloadRequest
    {
        Path = "no-existe.pdf"
    }, CancellationToken.None);

    Assert.False(resultado.IsSuccess);
    Assert.Equal(StorageErrorCode.NotFound, resultado.ErrorCode);
}
```

### Probar eliminación

```csharp
[Fact]
public async Task Eliminar_ArchivoExistente_DebeRemoverDeStorage()
{
    var storage = new InMemoryStorageProvider();

    // Subir primero
    await storage.UploadAsync(new UploadRequest
    {
        Path = "temp/prueba.txt",
        Content = new MemoryStream("contenido"u8.ToArray())
    }, CancellationToken.None);

    Assert.True(storage.Contains("temp/prueba.txt"));

    // Eliminar
    var resultado = await storage.DeleteAsync("temp/prueba.txt", CancellationToken.None);

    Assert.True(resultado.IsSuccess);
    Assert.False(storage.Contains("temp/prueba.txt"));
}
```

### Probar listado de archivos

```csharp
[Fact]
public async Task Listar_ArchivosEnPrefijo_DebeRetornarSoloLosDelPrefijo()
{
    var storage = new InMemoryStorageProvider();

    await storage.UploadAsync(new UploadRequest
    {
        Path = "facturas/enero/001.pdf",
        Content = new MemoryStream("a"u8.ToArray())
    }, CancellationToken.None);

    await storage.UploadAsync(new UploadRequest
    {
        Path = "facturas/febrero/002.pdf",
        Content = new MemoryStream("b"u8.ToArray())
    }, CancellationToken.None);

    await storage.UploadAsync(new UploadRequest
    {
        Path = "contratos/2024.pdf",
        Content = new MemoryStream("c"u8.ToArray())
    }, CancellationToken.None);

    var resultado = await storage.ListFilesAsync("facturas/", CancellationToken.None);

    Assert.True(resultado.IsSuccess);
    Assert.Equal(2, resultado.Value!.Count);
    Assert.All(resultado.Value, f => Assert.StartsWith("facturas/", f.Path));
}
```

## Uso de NSubstitute

Para pruebas más simples donde no necesitas inspeccionar el estado interno del storage, NSubstitute permite simular respuestas específicas:

```csharp
using NSubstitute;

[Fact]
public async Task ServicioDeDocumentos_AlSubir_DebeRegistrarEnDB()
{
    // Arrange
    var storage = Substitute.For<IStorageProvider>();
    var db = Substitute.For<IRepositorioDocumentos>();

    storage.UploadAsync(Arg.Any<UploadRequest>(), Arg.Any<CancellationToken>())
        .Returns(StorageResult<UploadResult>.Success(new UploadResult
        {
            Path = "documentos/test.pdf",
            Url = "https://cdn.ejemplo.com/documentos/test.pdf",
            SizeBytes = 1024
        }));

    var servicio = new ServicioDocumentos(storage, db);

    // Act
    await servicio.SubirYRegistrarAsync(
        new MemoryStream(), "test.pdf", "usuario-1", CancellationToken.None);

    // Assert: verificar que se llamó al repositorio con los datos correctos
    await db.Received(1).GuardarAsync(
        Arg.Is<Documento>(d => d.RutaStorage == "documentos/test.pdf"));
}
```

```csharp
[Fact]
public async Task ServicioDeDescarga_CuandoNoExiste_DebeRetornar404()
{
    var storage = Substitute.For<IStorageProvider>();

    storage.DownloadAsync(Arg.Any<DownloadRequest>(), Arg.Any<CancellationToken>())
        .Returns(StorageResult<DownloadResult>.Failure(
            StorageErrorCode.NotFound, "Archivo no encontrado."));

    var servicio = new ServicioDescarga(storage);

    var resultado = await servicio.ObtenerArchivoAsync("inexistente.pdf", CancellationToken.None);

    Assert.Null(resultado);
}
```

## Fixture compartida entre pruebas (xUnit IClassFixture)

```csharp
public class StorageFixture : IDisposable
{
    public InMemoryStorageProvider Storage { get; } = new InMemoryStorageProvider();

    public void Dispose() => Storage.Clear();
}

public class PruebasIntegracion : IClassFixture<StorageFixture>
{
    private readonly InMemoryStorageProvider _storage;

    public PruebasIntegracion(StorageFixture fixture)
    {
        _storage = fixture.Storage;
        _storage.Clear(); // Limpiar antes de cada prueba
    }

    [Fact]
    public async Task Prueba1_DebeFuncionar()
    {
        await _storage.UploadAsync(new UploadRequest
        {
            Path = "prueba1/archivo.txt",
            Content = new MemoryStream("prueba1"u8.ToArray())
        }, CancellationToken.None);

        Assert.True(_storage.Contains("prueba1/archivo.txt"));
    }

    [Fact]
    public async Task Prueba2_StorageDebeEstarLimpio()
    {
        // Gracias al Clear() en el constructor, el estado de Prueba1 no afecta aquí
        Assert.Equal(0, _storage.FileCount);
    }
}
```

## Tabla de comparación de estrategias de prueba

| Estrategia | Herramienta | Cuándo usar |
|---|---|---|
| `InMemoryStorageProvider` | `ValiBlob.Testing` | Pruebas unitarias e integración ligera. Sin infraestructura. |
| Sustituto (mock) con NSubstitute | `NSubstitute` | Solo verificar comportamiento, no el estado de los datos. |
| `LocalStorageProvider` con carpeta temporal | `ValiBlob.Local` | Pruebas que necesitan un proveedor de archivos real en disco. |
| LocalStack (AWS) | `ValiBlob.AWS` | Pruebas de integración end-to-end con S3 emulado localmente. |
| Azurite (Azure) | `ValiBlob.Azure` | Pruebas de integración end-to-end con Azure Blob emulado. |

## Prueba del pipeline completo

```csharp
[Fact]
public async Task Pipeline_ConValidacion_DebeRechazarArchivoGrande()
{
    // Configurar ValiBlob con InMemoryStorageProvider y pipeline de validación
    var services = new ServiceCollection();
    services
        .AddValiBlob(o => o.DefaultProvider = "test")
        .AddProvider<InMemoryStorageProvider>("test")
        .WithPipeline(p => p
            .UseValidation(v =>
            {
                v.MaxFileSizeBytes = 1000; // Solo 1 KB máximo
            })
        );

    var provider = services.BuildServiceProvider();
    var storage = provider.GetRequiredService<IStorageProvider>();

    // Archivo mayor a 1 KB
    var contenidoGrande = new byte[5000];
    var resultado = await storage.UploadAsync(new UploadRequest
    {
        Path = "test/grande.bin",
        Content = new MemoryStream(contenidoGrande),
        KnownSize = contenidoGrande.Length
    }, CancellationToken.None);

    Assert.False(resultado.IsSuccess);
    Assert.Equal(StorageErrorCode.FileTooLarge, resultado.ErrorCode);
}
```

:::tip Consejo
Usa `InMemoryStorageProvider` para la gran mayoría de las pruebas unitarias. Solo recurre a proveedores reales (LocalStack, Azurite) cuando necesites probar comportamientos específicos del proveedor como multipart uploads, URLs prefirmadas, o políticas de acceso de bucket.
:::

:::info Información
`InMemoryStorageProvider` implementa tanto `IStorageProvider` como `IResumableStorageProvider`, por lo que puedes usarlo también para probar el flujo completo de subidas reanudables (inicio de sesión, envío de fragmentos, finalización) sin infraestructura externa.
:::

:::note Nota
Llama siempre a `_storage.Clear()` entre pruebas para evitar que el estado de una prueba contamine otra. Si usas `IClassFixture`, hazlo en el constructor de la clase de prueba, no en el `Dispose` del fixture (el fixture se comparte entre todos los tests de la clase).
:::
