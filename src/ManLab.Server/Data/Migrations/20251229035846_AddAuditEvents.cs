using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAuditEvents : Migration
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditEvents");
        }
    }
}
