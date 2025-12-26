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
                name: "Nodes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Hostname = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    IpAddress = table.Column<string>(type: "character varying(45)", maxLength: 45, nullable: true),
                    OS = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    AgentVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    LastSeen = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
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
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OnboardingMachines", x => x.Id);
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
                name: "CommandQueue",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    CommandType = table.Column<int>(type: "integer", nullable: false),
                    Payload = table.Column<string>(type: "jsonb", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
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
                    Temperature = table.Column<float>(type: "real", nullable: true)
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

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_CreatedAt",
                table: "CommandQueue",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CommandQueue_NodeId",
                table: "CommandQueue",
                column: "NodeId");

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CommandQueue");

            migrationBuilder.DropTable(
                name: "EnrollmentTokens");

            migrationBuilder.DropTable(
                name: "OnboardingMachines");

            migrationBuilder.DropTable(
                name: "SshAuditEvents");

            migrationBuilder.DropTable(
                name: "TelemetrySnapshots");

            migrationBuilder.DropTable(
                name: "Nodes");
        }
    }
}
