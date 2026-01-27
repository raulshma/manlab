using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemUpdateEntities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SystemUpdateHistory",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    NodeId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ScheduledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    UpdateType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    PreUpdateStateJson = table.Column<string>(type: "jsonb", nullable: true),
                    PostUpdateStateJson = table.Column<string>(type: "jsonb", nullable: true),
                    PackagesJson = table.Column<string>(type: "jsonb", nullable: true),
                    OutputLog = table.Column<string>(type: "text", nullable: true),
                    ErrorMessage = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    RebootRequired = table.Column<bool>(type: "boolean", nullable: false),
                    RebootApproved = table.Column<bool>(type: "boolean", nullable: false),
                    RebootedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ActorType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ActorId = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    NodeId1 = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SystemUpdateHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SystemUpdateHistory_Nodes_NodeId",
                        column: x => x.NodeId,
                        principalTable: "Nodes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SystemUpdateHistory_Nodes_NodeId1",
                        column: x => x.NodeId1,
                        principalTable: "Nodes",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "SystemUpdateLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UpdateHistoryId = table.Column<Guid>(type: "uuid", nullable: false),
                    TimestampUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Level = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Message = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: false),
                    Details = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SystemUpdateLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SystemUpdateLogs_SystemUpdateHistory_UpdateHistoryId",
                        column: x => x.UpdateHistoryId,
                        principalTable: "SystemUpdateHistory",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_NodeId",
                table: "SystemUpdateHistory",
                column: "NodeId");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_NodeId_StartedAt",
                table: "SystemUpdateHistory",
                columns: new[] { "NodeId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_NodeId_Status",
                table: "SystemUpdateHistory",
                columns: new[] { "NodeId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_NodeId1",
                table: "SystemUpdateHistory",
                column: "NodeId1");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_StartedAt",
                table: "SystemUpdateHistory",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateHistory_Status",
                table: "SystemUpdateHistory",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateLogs_Level",
                table: "SystemUpdateLogs",
                column: "Level");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateLogs_TimestampUtc",
                table: "SystemUpdateLogs",
                column: "TimestampUtc");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateLogs_UpdateHistoryId",
                table: "SystemUpdateLogs",
                column: "UpdateHistoryId");

            migrationBuilder.CreateIndex(
                name: "IX_SystemUpdateLogs_UpdateHistoryId_TimestampUtc",
                table: "SystemUpdateLogs",
                columns: new[] { "UpdateHistoryId", "TimestampUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SystemUpdateLogs");

            migrationBuilder.DropTable(
                name: "SystemUpdateHistory");
        }
    }
}
