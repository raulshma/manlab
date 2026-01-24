using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EventName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Category = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Message = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: true),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ActorType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ActorId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ActorName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ActorIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    UserAgent = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CommandId = table.Column<Guid>(type: "uuid", nullable: true),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: true),
                    MachineId = table.Column<Guid>(type: "uuid", nullable: true),
                    HttpMethod = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    HttpPath = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    HttpStatusCode = table.Column<int>(type: "integer", nullable: true),
                    Hub = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    HubMethod = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ConnectionId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    RequestId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    TraceId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    SpanId = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    DataJson = table.Column<string>(type: "jsonb", nullable: true),
                    Error = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EnrollmentTokens",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UsedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MachineId = table.Column<Guid>(type: "uuid", nullable: true),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EnrollmentTokens", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HttpMonitorConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    Method = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ExpectedStatus = table.Column<int>(type: "integer", nullable: true),
                    BodyContains = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    TimeoutMs = table.Column<int>(type: "integer", nullable: false),
                    Cron = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastRunAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSuccessAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HttpMonitorConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "NetworkToolHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ToolType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    InputJson = table.Column<string>(type: "jsonb", nullable: true),
                    ResultJson = table.Column<string>(type: "jsonb", nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: false),
                    ErrorMessage = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    TagsJson = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Notes = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: true),
                    UpdatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ConnectionId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Target = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NetworkToolHistory", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Nodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Hostname = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    IpAddress = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    OS = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    AgentVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CapabilitiesJson = table.Column<string>(type: "jsonb", nullable: true),
                    PrimaryInterface = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    MacAddress = table.Column<string>(type: "character varying(17)", maxLength: 17, nullable: true),
                    LastSeen = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ErrorCode = table.Column<int>(type: "integer", nullable: true),
                    ErrorMessage = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    ErrorAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AuthKeyHash = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Nodes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "OnboardingMachines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Port = table.Column<int>(type: "integer", nullable: false),
                    Username = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    AuthMode = table.Column<int>(type: "integer", nullable: false),
                    HostKeyFingerprint = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    LastError = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: true),
                    LinkedNodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EncryptedSshPassword = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    EncryptedPrivateKeyPem = table.Column<string>(type: "character varying(8192)", maxLength: 8192, nullable: true),
                    EncryptedPrivateKeyPassphrase = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    EncryptedSudoPassword = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    TrustHostKey = table.Column<bool>(type: "boolean", nullable: false),
                    ForceInstall = table.Column<bool>(type: "boolean", nullable: false),
                    RunAsRoot = table.Column<bool>(type: "boolean", nullable: false),
                    ServerBaseUrlOverride = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OnboardingMachines", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ScheduledNetworkToolConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    ToolType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Target = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    ParametersJson = table.Column<string>(type: "jsonb", nullable: true),
                    Cron = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastRunAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastSuccessAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScheduledNetworkToolConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Scripts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Shell = table.Column<int>(type: "integer", nullable: false),
                    Content = table.Column<string>(type: "character varying(100000)", maxLength: 100000, nullable: false),
                    IsReadOnly = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Scripts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SshAuditEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Actor = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ActorIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Action = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    MachineId = table.Column<Guid>(type: "uuid", nullable: true),
                    Host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Port = table.Column<int>(type: "integer", nullable: true),
                    Username = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    HostKeyFingerprint = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    Error = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    OsFamily = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    OsDistro = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    OsVersion = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    CpuArch = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SshAuditEvents", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SystemSettings",
                columns: table => new
                {
                    Key = table.Column<string>(type: "text", nullable: false),
                    Value = table.Column<string>(type: "text", nullable: true),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Category = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SystemSettings", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "TrafficMonitorConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InterfaceName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Cron = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastRunAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrafficMonitorConfigs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TrafficSamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    InterfaceName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    RxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    TxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    RxErrors = table.Column<long>(type: "bigint", nullable: true),
                    TxErrors = table.Column<long>(type: "bigint", nullable: true),
                    SpeedBps = table.Column<long>(type: "bigint", nullable: true),
                    UtilizationPercent = table.Column<float>(type: "real", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrafficSamples", x => new { x.Id, x.TimestampUtc });
                });

            migrationBuilder.CreateTable(
                name: "HttpMonitorChecks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    MonitorId = table.Column<Guid>(type: "uuid", nullable: false),
                    StatusCode = table.Column<int>(type: "integer", nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    ResponseTimeMs = table.Column<int>(type: "integer", nullable: false),
                    KeywordMatched = table.Column<bool>(type: "boolean", nullable: true),
                    SslDaysRemaining = table.Column<int>(type: "integer", nullable: true),
                    ErrorMessage = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HttpMonitorChecks", x => new { x.Id, x.TimestampUtc });
                    table.ForeignKey(
                        name: "FK_HttpMonitorChecks_HttpMonitorConfigs_MonitorId",
                        column: x => x.MonitorId,
                        principalTable: "HttpMonitorConfigs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertRules",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Scope = table.Column<int>(type: "integer", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    Condition = table.Column<string>(type: "jsonb", nullable: false),
                    Severity = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AlertRules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AlertRules_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CommandQueue",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommandType = table.Column<int>(type: "integer", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DispatchAttempts = table.Column<int>(type: "integer", nullable: false),
                    LastDispatchAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    OutputLog = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExecutedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CommandQueue", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CommandQueue_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "FileBrowserPolicies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    RootPath = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    MaxBytesPerRead = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FileBrowserPolicies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FileBrowserPolicies_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GpuSnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    GpuIndex = table.Column<int>(type: "integer", nullable: false),
                    Vendor = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    UtilizationPercent = table.Column<float>(type: "real", nullable: true),
                    MemoryUsedBytes = table.Column<long>(type: "bigint", nullable: true),
                    MemoryTotalBytes = table.Column<long>(type: "bigint", nullable: true),
                    TemperatureC = table.Column<float>(type: "real", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GpuSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GpuSnapshots_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LogViewerPolicies",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Path = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    MaxBytesPerRequest = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LogViewerPolicies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LogViewerPolicies_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NodeSettings",
                columns: table => new
                {
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: true),
                    Description = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    Category = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NodeSettings", x => new { x.NodeId, x.Key });
                    table.ForeignKey(
                        name: "FK_NodeSettings_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceMonitorConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    ServiceName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceMonitorConfigs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceMonitorConfigs_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ServiceStatusSnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ServiceName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    State = table.Column<int>(type: "integer", nullable: false),
                    Detail = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ServiceStatusSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ServiceStatusSnapshots_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SmartDriveSnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Device = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Health = table.Column<int>(type: "integer", nullable: false),
                    TemperatureC = table.Column<float>(type: "real", nullable: true),
                    PowerOnHours = table.Column<int>(type: "integer", nullable: true),
                    Raw = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SmartDriveSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SmartDriveSnapshots_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TelemetrySnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CpuUsage = table.Column<float>(type: "real", nullable: false),
                    RamUsage = table.Column<float>(type: "real", nullable: false),
                    DiskUsage = table.Column<float>(type: "real", nullable: false),
                    Temperature = table.Column<float>(type: "real", nullable: true),
                    NetRxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    NetTxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    PingTarget = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    PingRttMs = table.Column<float>(type: "real", nullable: true),
                    PingPacketLossPercent = table.Column<float>(type: "real", nullable: true),
                    AgentCpuPercent = table.Column<float>(type: "real", nullable: true),
                    AgentMemoryBytes = table.Column<long>(type: "bigint", nullable: true),
                    AgentGcHeapBytes = table.Column<long>(type: "bigint", nullable: true),
                    AgentThreadCount = table.Column<int>(type: "integer", nullable: true),
                    EnhancedNetworkJson = table.Column<string>(type: "text", nullable: true),
                    EnhancedGpuJson = table.Column<string>(type: "text", nullable: true),
                    ApmJson = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetrySnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TelemetrySnapshots_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TerminalSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedBy = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ClosedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TerminalSessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TerminalSessions_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "UpsSnapshots",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Backend = table.Column<int>(type: "integer", nullable: false),
                    BatteryPercent = table.Column<float>(type: "real", nullable: true),
                    LoadPercent = table.Column<float>(type: "real", nullable: true),
                    OnBattery = table.Column<bool>(type: "boolean", nullable: true),
                    EstimatedRuntimeSeconds = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UpsSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_UpsSnapshots_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ScriptRuns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ScriptId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedBy = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    StdoutTail = table.Column<string>(type: "text", nullable: true),
                    StderrTail = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    FinishedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScriptRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ScriptRuns_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ScriptRuns_Scripts_ScriptId",
                        column: x => x.ScriptId,
                        principalTable: "Scripts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "AlertEvents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AlertRuleId = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Message = table.Column<string>(type: "character varying(8192)", maxLength: 8192, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AlertEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AlertEvents_AlertRules_AlertRuleId",
                        column: x => x.AlertRuleId,
                        principalTable: "AlertRules",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_AlertEvents_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_AlertRuleId",
                table: "AlertEvents",
                column: "AlertRuleId");

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_AlertRuleId_Status_StartedAt",
                table: "AlertEvents",
                columns: new[] { "AlertRuleId", "Status", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_NodeId",
                table: "AlertEvents",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_StartedAt",
                table: "AlertEvents",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_AlertEvents_Status",
                table: "AlertEvents",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_AlertRules_Enabled",
                table: "AlertRules",
                column: "Enabled");

            migrationBuilder.CreateIndex(
                name: "IX_AlertRules_NodeId",
                table: "AlertRules",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_AlertRules_Scope",
                table: "AlertRules",
                column: "Scope");

            migrationBuilder.CreateIndex(
                name: "IX_AlertRules_UpdatedAt",
                table: "AlertRules",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_CommandId",
                table: "AuditEvents",
                column: "CommandId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_EventName",
                table: "AuditEvents",
                column: "EventName");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_Kind",
                table: "AuditEvents",
                column: "Kind");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_NodeId",
                table: "AuditEvents",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_Success",
                table: "AuditEvents",
                column: "Success");

            migrationBuilder.CreateIndex(
                name: "IX_AuditEvents_TimestampUtc",
                table: "AuditEvents",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_CreatedAt",
                table: "CommandQueue",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId",
                table: "CommandQueue",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId_CommandType_Status_CreatedAt",
                table: "CommandQueue",
                columns: new[] { "NodeId", "CommandType", "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId_CreatedAt",
                table: "CommandQueue",
                columns: new[] { "NodeId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_Status",
                table: "CommandQueue",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentTokens_ExpiresAt",
                table: "EnrollmentTokens",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentTokens_MachineId",
                table: "EnrollmentTokens",
                column: "MachineId");

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentTokens_TokenHash",
                table: "EnrollmentTokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentTokens_UsedAt",
                table: "EnrollmentTokens",
                column: "UsedAt");

            migrationBuilder.CreateIndex(
                name: "IX_FileBrowserPolicies_NodeId",
                table: "FileBrowserPolicies",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_NodeId",
                table: "GpuSnapshots",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_NodeId_GpuIndex_Timestamp",
                table: "GpuSnapshots",
                columns: new[] { "NodeId", "GpuIndex", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_NodeId_Timestamp",
                table: "GpuSnapshots",
                columns: new[] { "NodeId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_NodeId_Timestamp_GpuIndex",
                table: "GpuSnapshots",
                columns: new[] { "NodeId", "Timestamp", "GpuIndex" });

            migrationBuilder.CreateIndex(
                name: "IX_GpuSnapshots_Timestamp",
                table: "GpuSnapshots",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_MonitorId",
                table: "HttpMonitorChecks",
                column: "MonitorId");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_MonitorId_Success_TimestampUtc",
                table: "HttpMonitorChecks",
                columns: new[] { "MonitorId", "Success", "TimestampUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_MonitorId_TimestampUtc",
                table: "HttpMonitorChecks",
                columns: new[] { "MonitorId", "TimestampUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_TimestampUtc",
                table: "HttpMonitorChecks",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorConfigs_Enabled",
                table: "HttpMonitorConfigs",
                column: "Enabled");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorConfigs_UpdatedAt",
                table: "HttpMonitorConfigs",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorConfigs_Url",
                table: "HttpMonitorConfigs",
                column: "Url");

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId",
                table: "LogViewerPolicies",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId_DisplayName",
                table: "LogViewerPolicies",
                columns: new[] { "NodeId", "DisplayName" });

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId_Path",
                table: "LogViewerPolicies",
                columns: new[] { "NodeId", "Path" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NetworkToolHistory_TimestampUtc",
                table: "NetworkToolHistory",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_NetworkToolHistory_ToolType",
                table: "NetworkToolHistory",
                column: "ToolType");

            migrationBuilder.CreateIndex(
                name: "IX_NetworkToolHistory_ToolType_TimestampUtc",
                table: "NetworkToolHistory",
                columns: new[] { "ToolType", "TimestampUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Nodes_AuthKeyHash",
                table: "Nodes",
                column: "AuthKeyHash");

            migrationBuilder.CreateIndex(
                name: "IX_Nodes_Hostname",
                table: "Nodes",
                column: "Hostname");

            migrationBuilder.CreateIndex(
                name: "IX_Nodes_LastSeen",
                table: "Nodes",
                column: "LastSeen");

            migrationBuilder.CreateIndex(
                name: "IX_Nodes_Status",
                table: "Nodes",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_NodeSettings_NodeId",
                table: "NodeSettings",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_OnboardingMachines_Host",
                table: "OnboardingMachines",
                column: "Host");

            migrationBuilder.CreateIndex(
                name: "IX_OnboardingMachines_Status",
                table: "OnboardingMachines",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_OnboardingMachines_UpdatedAt",
                table: "OnboardingMachines",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNetworkToolConfigs_Enabled",
                table: "ScheduledNetworkToolConfigs",
                column: "Enabled");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNetworkToolConfigs_ToolType",
                table: "ScheduledNetworkToolConfigs",
                column: "ToolType");

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNetworkToolConfigs_ToolType_Enabled",
                table: "ScheduledNetworkToolConfigs",
                columns: new[] { "ToolType", "Enabled" });

            migrationBuilder.CreateIndex(
                name: "IX_ScheduledNetworkToolConfigs_UpdatedAt",
                table: "ScheduledNetworkToolConfigs",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScriptRuns_CreatedAt",
                table: "ScriptRuns",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ScriptRuns_NodeId",
                table: "ScriptRuns",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_ScriptRuns_NodeId_CreatedAt",
                table: "ScriptRuns",
                columns: new[] { "NodeId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ScriptRuns_ScriptId",
                table: "ScriptRuns",
                column: "ScriptId");

            migrationBuilder.CreateIndex(
                name: "IX_ScriptRuns_Status",
                table: "ScriptRuns",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Scripts_Name",
                table: "Scripts",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Scripts_UpdatedAt",
                table: "Scripts",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceMonitorConfigs_NodeId",
                table: "ServiceMonitorConfigs",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceMonitorConfigs_NodeId_ServiceName",
                table: "ServiceMonitorConfigs",
                columns: new[] { "NodeId", "ServiceName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_NodeId",
                table: "ServiceStatusSnapshots",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_NodeId_ServiceName_Timestamp",
                table: "ServiceStatusSnapshots",
                columns: new[] { "NodeId", "ServiceName", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_NodeId_Timestamp",
                table: "ServiceStatusSnapshots",
                columns: new[] { "NodeId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_NodeId_Timestamp_ServiceName",
                table: "ServiceStatusSnapshots",
                columns: new[] { "NodeId", "Timestamp", "ServiceName" });

            migrationBuilder.CreateIndex(
                name: "IX_ServiceStatusSnapshots_Timestamp",
                table: "ServiceStatusSnapshots",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_NodeId",
                table: "SmartDriveSnapshots",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_NodeId_Device_Timestamp",
                table: "SmartDriveSnapshots",
                columns: new[] { "NodeId", "Device", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_NodeId_Timestamp",
                table: "SmartDriveSnapshots",
                columns: new[] { "NodeId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_NodeId_Timestamp_Device",
                table: "SmartDriveSnapshots",
                columns: new[] { "NodeId", "Timestamp", "Device" });

            migrationBuilder.CreateIndex(
                name: "IX_SmartDriveSnapshots_Timestamp",
                table: "SmartDriveSnapshots",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_SshAuditEvents_Action",
                table: "SshAuditEvents",
                column: "Action");

            migrationBuilder.CreateIndex(
                name: "IX_SshAuditEvents_Host",
                table: "SshAuditEvents",
                column: "Host");

            migrationBuilder.CreateIndex(
                name: "IX_SshAuditEvents_MachineId",
                table: "SshAuditEvents",
                column: "MachineId");

            migrationBuilder.CreateIndex(
                name: "IX_SshAuditEvents_Success",
                table: "SshAuditEvents",
                column: "Success");

            migrationBuilder.CreateIndex(
                name: "IX_SshAuditEvents_TimestampUtc",
                table: "SshAuditEvents",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetrySnapshots_NodeId",
                table: "TelemetrySnapshots",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetrySnapshots_NodeId_Timestamp",
                table: "TelemetrySnapshots",
                columns: new[] { "NodeId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_TelemetrySnapshots_Timestamp",
                table: "TelemetrySnapshots",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_TerminalSessions_ExpiresAt",
                table: "TerminalSessions",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_TerminalSessions_NodeId",
                table: "TerminalSessions",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_TerminalSessions_NodeId_CreatedAt",
                table: "TerminalSessions",
                columns: new[] { "NodeId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TerminalSessions_Status",
                table: "TerminalSessions",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficMonitorConfigs_Enabled",
                table: "TrafficMonitorConfigs",
                column: "Enabled");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficMonitorConfigs_InterfaceName",
                table: "TrafficMonitorConfigs",
                column: "InterfaceName");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficMonitorConfigs_UpdatedAt",
                table: "TrafficMonitorConfigs",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficSamples_InterfaceName",
                table: "TrafficSamples",
                column: "InterfaceName");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficSamples_InterfaceName_TimestampUtc",
                table: "TrafficSamples",
                columns: new[] { "InterfaceName", "TimestampUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_TrafficSamples_TimestampUtc",
                table: "TrafficSamples",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_UpsSnapshots_NodeId",
                table: "UpsSnapshots",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_UpsSnapshots_NodeId_Timestamp",
                table: "UpsSnapshots",
                columns: new[] { "NodeId", "Timestamp" });

            migrationBuilder.CreateIndex(
                name: "IX_UpsSnapshots_Timestamp",
                table: "UpsSnapshots",
                column: "Timestamp");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AlertEvents");

            migrationBuilder.DropTable(
                name: "AuditEvents");

            migrationBuilder.DropTable(
                name: "CommandQueue");

            migrationBuilder.DropTable(
                name: "EnrollmentTokens");

            migrationBuilder.DropTable(
                name: "FileBrowserPolicies");

            migrationBuilder.DropTable(
                name: "GpuSnapshots");

            migrationBuilder.DropTable(
                name: "HttpMonitorChecks");

            migrationBuilder.DropTable(
                name: "LogViewerPolicies");

            migrationBuilder.DropTable(
                name: "NetworkToolHistory");

            migrationBuilder.DropTable(
                name: "NodeSettings");

            migrationBuilder.DropTable(
                name: "OnboardingMachines");

            migrationBuilder.DropTable(
                name: "ScheduledNetworkToolConfigs");

            migrationBuilder.DropTable(
                name: "ScriptRuns");

            migrationBuilder.DropTable(
                name: "ServiceMonitorConfigs");

            migrationBuilder.DropTable(
                name: "ServiceStatusSnapshots");

            migrationBuilder.DropTable(
                name: "SmartDriveSnapshots");

            migrationBuilder.DropTable(
                name: "SshAuditEvents");

            migrationBuilder.DropTable(
                name: "SystemSettings");

            migrationBuilder.DropTable(
                name: "TelemetrySnapshots");

            migrationBuilder.DropTable(
                name: "TerminalSessions");

            migrationBuilder.DropTable(
                name: "TrafficMonitorConfigs");

            migrationBuilder.DropTable(
                name: "TrafficSamples");

            migrationBuilder.DropTable(
                name: "UpsSnapshots");

            migrationBuilder.DropTable(
                name: "AlertRules");

            migrationBuilder.DropTable(
                name: "HttpMonitorConfigs");

            migrationBuilder.DropTable(
                name: "Scripts");

            migrationBuilder.DropTable(
                name: "Nodes");
        }
    }
}
