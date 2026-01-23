using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddNetworkToolHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
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
                    ConnectionId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    Target = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NetworkToolHistory", x => x.Id);
                });

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NetworkToolHistory");
        }
    }
}
