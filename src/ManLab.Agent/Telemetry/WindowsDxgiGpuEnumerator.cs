using System.Runtime.InteropServices;
using ManLab.Shared.Dtos;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Windows GPU adapter enumeration via DXGI.
///
/// This is a best-effort mechanism to detect GPUs even when vendor tools
/// (e.g. nvidia-smi) are not installed. DXGI does not provide utilization
/// or temperature; we only populate identity and (when available) dedicated VRAM.
/// </summary>
internal static class WindowsDxgiGpuEnumerator
{
    public static List<GpuTelemetry> EnumerateGpus()
    {
        var result = new List<GpuTelemetry>(capacity: 4);

        // Never call into DXGI on non-Windows.
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return result;
        }

        var factoryPtr = IntPtr.Zero;
        try
        {
            var iidFactory = typeof(IDXGIFactory1).GUID;
            var hr = CreateDXGIFactory1(ref iidFactory, out factoryPtr);
            if (hr < 0 || factoryPtr == IntPtr.Zero)
            {
                return result;
            }

            var factory = (IDXGIFactory1)Marshal.GetObjectForIUnknown(factoryPtr);
            try
            {
                // Bound the enumeration defensively.
                for (var index = 0; index < 32; index++)
                {
                    IDXGIAdapter1 adapter;
                    try
                    {
                        factory.EnumAdapters1((uint)index, out adapter);
                    }
                    catch (COMException ex) when ((uint)ex.HResult == DXGI_ERROR_NOT_FOUND)
                    {
                        break;
                    }

                    try
                    {
                        DXGI_ADAPTER_DESC1 desc;
                        adapter.GetDesc1(out desc);

                        // Skip software adapters (e.g. Microsoft Basic Render Driver).
                        if ((desc.Flags & (uint)DXGI_ADAPTER_FLAG.DXGI_ADAPTER_FLAG_SOFTWARE) != 0)
                        {
                            index++;
                            continue;
                        }

                        var vendor = VendorFromPciId(desc.VendorId);
                        var name = string.IsNullOrWhiteSpace(desc.Description) ? null : desc.Description.Trim();

                        var gpu = new GpuTelemetry
                        {
                            Vendor = vendor,
                            Index = index,
                            Name = name
                        };

                        // DedicatedVideoMemory is 0 on many iGPUs; keep null in that case.
                        var dedicated = (long)desc.DedicatedVideoMemory;
                        if (dedicated > 0)
                        {
                            gpu.MemoryTotalBytes = dedicated;
                        }

                        result.Add(gpu);
                    }
                    finally
                    {
                        try { Marshal.FinalReleaseComObject(adapter); } catch { /* ignore */ }
                    }

                }
            }
            finally
            {
                try { Marshal.FinalReleaseComObject(factory); } catch { /* ignore */ }
            }
        }
        catch
        {
            return result;
        }
        finally
        {
            if (factoryPtr != IntPtr.Zero)
            {
                try { Marshal.Release(factoryPtr); } catch { /* ignore */ }
            }
        }

        return result;
    }

    private static string VendorFromPciId(uint vendorId)
    {
        return vendorId switch
        {
            0x10DE => "nvidia",
            0x1002 => "amd",
            0x8086 => "intel",
            _ => "unknown"
        };
    }

    private const uint DXGI_ERROR_NOT_FOUND = 0x887A0002;

    [DllImport("dxgi.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int CreateDXGIFactory1(ref Guid riid, out IntPtr ppFactory);

    [ComImport]
    [Guid("770aae78-f26f-4dba-a829-253c83d1b387")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIFactory1
    {
        // IDXGIObject
        void SetPrivateData();
        void SetPrivateDataInterface();
        void GetPrivateData();
        void GetParent();

        // IDXGIFactory
        void EnumAdapters();
        void MakeWindowAssociation();
        void GetWindowAssociation();
        void CreateSwapChain();
        void CreateSoftwareAdapter();

        // IDXGIFactory1
        void EnumAdapters1(uint Adapter, out IDXGIAdapter1 ppAdapter);
        void IsCurrent();
    }

    [ComImport]
    [Guid("29038f61-3839-4626-91fd-086879011a05")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDXGIAdapter1
    {
        // IDXGIObject
        void SetPrivateData();
        void SetPrivateDataInterface();
        void GetPrivateData();
        void GetParent();

        // IDXGIAdapter
        void EnumOutputs();
        void GetDesc();
        void CheckInterfaceSupport();

        // IDXGIAdapter1
        void GetDesc1(out DXGI_ADAPTER_DESC1 desc);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DXGI_ADAPTER_DESC1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string Description;
        public uint VendorId;
        public uint DeviceId;
        public uint SubSysId;
        public uint Revision;
        public nuint DedicatedVideoMemory;
        public nuint DedicatedSystemMemory;
        public nuint SharedSystemMemory;
        public uint AdapterLuidLowPart;
        public int AdapterLuidHighPart;
        public uint Flags;
    }

    private enum DXGI_ADAPTER_FLAG : uint
    {
        DXGI_ADAPTER_FLAG_NONE = 0,
        DXGI_ADAPTER_FLAG_REMOTE = 1,
        DXGI_ADAPTER_FLAG_SOFTWARE = 2
    }
}
