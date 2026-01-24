using System;
using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    [DbContext(typeof(DataContext))]
    [Migration("20260124093000_AddMonitoringJobsAndTimescale")]
    public partial class AddMonitoringJobsAndTimescale : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
                name: "HttpMonitorChecks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    MonitorId = table.Column<Guid>(type: "uuid", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    StatusCode = table.Column<int>(type: "integer", nullable: true),
                    Success = table.Column<bool>(type: "boolean", nullable: false),
                    ResponseTimeMs = table.Column<int>(type: "integer", nullable: false),
                    KeywordMatched = table.Column<bool>(type: "boolean", nullable: true),
                    SslDaysRemaining = table.Column<int>(type: "integer", nullable: true),
                    ErrorMessage = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HttpMonitorChecks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HttpMonitorChecks_HttpMonitorConfigs_MonitorId",
                        column: x => x.MonitorId,
                        principalTable: "HttpMonitorConfigs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TrafficSamples",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    InterfaceName = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    TxBytesPerSec = table.Column<long>(type: "bigint", nullable: true),
                    RxErrors = table.Column<long>(type: "bigint", nullable: true),
                    TxErrors = table.Column<long>(type: "bigint", nullable: true),
                    SpeedBps = table.Column<long>(type: "bigint", nullable: true),
                    UtilizationPercent = table.Column<float>(type: "real", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TrafficSamples", x => x.Id);
                });

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
                name: "IX_HttpMonitorChecks_MonitorId",
                table: "HttpMonitorChecks",
                column: "MonitorId");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_TimestampUtc",
                table: "HttpMonitorChecks",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_MonitorId_TimestampUtc",
                table: "HttpMonitorChecks",
                columns: new[] { "MonitorId", "TimestampUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_HttpMonitorChecks_MonitorId_Success_TimestampUtc",
                table: "HttpMonitorChecks",
                columns: new[] { "MonitorId", "Success", "TimestampUtc" });

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
                name: "IX_TrafficSamples_TimestampUtc",
                table: "TrafficSamples",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_TrafficSamples_InterfaceName_TimestampUtc",
                table: "TrafficSamples",
                columns: new[] { "InterfaceName", "TimestampUtc" });

            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS timescaledb;");
            migrationBuilder.Sql("SELECT create_hypertable('" + "\"HttpMonitorChecks\"" + "', 'TimestampUtc', if_not_exists => TRUE);");
            migrationBuilder.Sql("SELECT create_hypertable('" + "\"TrafficSamples\"" + "', 'TimestampUtc', if_not_exists => TRUE);");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HttpMonitorChecks");

            migrationBuilder.DropTable(
                name: "TrafficSamples");

            migrationBuilder.DropTable(
                name: "HttpMonitorConfigs");

            migrationBuilder.DropTable(
                name: "TrafficMonitorConfigs");
        }
    }
}
