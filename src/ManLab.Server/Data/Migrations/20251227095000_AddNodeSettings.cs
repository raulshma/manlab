using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations;

[DbContext(typeof(DataContext))]
[Migration("20251227095000_AddNodeSettings")]

/// <inheritdoc />
public partial class AddNodeSettings : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
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

        migrationBuilder.CreateIndex(
            name: "IX_NodeSettings_NodeId",
            table: "NodeSettings",
            column: "NodeId");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(
            name: "NodeSettings");
    }
}
