using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class TelemetryRollupsAndProcessTelemetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ProcessTelemetryJson",
                table: "TelemetrySnapshots",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TelemetryRollups",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Granularity = table.Column<int>(type: "integer", nullable: false),
                    BucketStartUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    BucketSeconds = table.Column<int>(type: "integer", nullable: false),
                    SampleCount = table.Column<int>(type: "integer", nullable: false),
                    CpuAvg = table.Column<float>(type: "real", nullable: true),
                    CpuMin = table.Column<float>(type: "real", nullable: true),
                    CpuMax = table.Column<float>(type: "real", nullable: true),
                    CpuP95 = table.Column<float>(type: "real", nullable: true),
                    RamAvg = table.Column<float>(type: "real", nullable: true),
                    RamMin = table.Column<float>(type: "real", nullable: true),
                    RamMax = table.Column<float>(type: "real", nullable: true),
                    RamP95 = table.Column<float>(type: "real", nullable: true),
                    DiskAvg = table.Column<float>(type: "real", nullable: true),
                    DiskMin = table.Column<float>(type: "real", nullable: true),
                    DiskMax = table.Column<float>(type: "real", nullable: true),
                    DiskP95 = table.Column<float>(type: "real", nullable: true),
                    TempAvg = table.Column<float>(type: "real", nullable: true),
                    TempMin = table.Column<float>(type: "real", nullable: true),
                    TempMax = table.Column<float>(type: "real", nullable: true),
                    TempP95 = table.Column<float>(type: "real", nullable: true),
                    NetRxAvg = table.Column<double>(type: "double precision", nullable: true),
                    NetRxMax = table.Column<double>(type: "double precision", nullable: true),
                    NetRxP95 = table.Column<double>(type: "double precision", nullable: true),
                    NetTxAvg = table.Column<double>(type: "double precision", nullable: true),
                    NetTxMax = table.Column<double>(type: "double precision", nullable: true),
                    NetTxP95 = table.Column<double>(type: "double precision", nullable: true),
                    PingRttAvg = table.Column<float>(type: "real", nullable: true),
                    PingRttMax = table.Column<float>(type: "real", nullable: true),
                    PingRttP95 = table.Column<float>(type: "real", nullable: true),
                    PingLossAvg = table.Column<float>(type: "real", nullable: true),
                    PingLossMax = table.Column<float>(type: "real", nullable: true),
                    PingLossP95 = table.Column<float>(type: "real", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetryRollups", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryRollups_BucketStartUtc",
                table: "TelemetryRollups",
                column: "BucketStartUtc");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryRollups_NodeId",
                table: "TelemetryRollups",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryRollups_NodeId_Granularity_BucketStartUtc",
                table: "TelemetryRollups",
                columns: new[] { "NodeId", "Granularity", "BucketStartUtc" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TelemetryRollups");

            migrationBuilder.DropColumn(
                name: "ProcessTelemetryJson",
                table: "TelemetrySnapshots");
        }
    }
}
