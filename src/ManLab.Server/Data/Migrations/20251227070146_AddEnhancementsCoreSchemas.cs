using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEnhancementsCoreSchemas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
                name: "IX_GpuSnapshots_Timestamp",
                table: "GpuSnapshots",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId",
                table: "LogViewerPolicies",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_LogViewerPolicies_NodeId_Path",
                table: "LogViewerPolicies",
                columns: new[] { "NodeId", "Path" },
                unique: true);

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
                name: "IX_SmartDriveSnapshots_Timestamp",
                table: "SmartDriveSnapshots",
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
                name: "GpuSnapshots");

            migrationBuilder.DropTable(
                name: "LogViewerPolicies");

            migrationBuilder.DropTable(
                name: "ScriptRuns");

            migrationBuilder.DropTable(
                name: "ServiceMonitorConfigs");

            migrationBuilder.DropTable(
                name: "ServiceStatusSnapshots");

            migrationBuilder.DropTable(
                name: "SmartDriveSnapshots");

            migrationBuilder.DropTable(
                name: "TerminalSessions");

            migrationBuilder.DropTable(
                name: "UpsSnapshots");

            migrationBuilder.DropTable(
                name: "AlertRules");

            migrationBuilder.DropTable(
                name: "Scripts");
        }
    }
}
