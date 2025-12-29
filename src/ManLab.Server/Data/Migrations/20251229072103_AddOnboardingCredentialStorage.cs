using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ManLab.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddOnboardingCredentialStorage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncryptedPrivateKeyPassphrase",
                table: "OnboardingMachines",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EncryptedPrivateKeyPem",
                table: "OnboardingMachines",
                type: "character varying(8192)",
                maxLength: 8192,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EncryptedSshPassword",
                table: "OnboardingMachines",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EncryptedSudoPassword",
                table: "OnboardingMachines",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ForceInstall",
                table: "OnboardingMachines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RunAsRoot",
                table: "OnboardingMachines",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ServerBaseUrlOverride",
                table: "OnboardingMachines",
                type: "character varying(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "TrustHostKey",
                table: "OnboardingMachines",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncryptedPrivateKeyPassphrase",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "EncryptedPrivateKeyPem",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "EncryptedSshPassword",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "EncryptedSudoPassword",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "ForceInstall",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "RunAsRoot",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "ServerBaseUrlOverride",
                table: "OnboardingMachines");

            migrationBuilder.DropColumn(
                name: "TrustHostKey",
                table: "OnboardingMachines");
        }
    }
}
