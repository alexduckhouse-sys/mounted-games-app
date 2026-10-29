using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MountedGames.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CompetitionReadRevisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CompetitionReadRevisions",
                columns: table => new
                {
                    CompetitionId = table.Column<int>(type: "integer", nullable: false),
                    Standings = table.Column<long>(type: "bigint", nullable: false),
                    Detail = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompetitionReadRevisions", x => x.CompetitionId);
                });
            foreach (var sql in CompetitionReadRevisionSchemaV1.Create(sqlite: false))
                migrationBuilder.Sql(sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var sql in CompetitionReadRevisionSchemaV1.DropPostgres())
                migrationBuilder.Sql(sql);
            migrationBuilder.DropTable(
                name: "CompetitionReadRevisions");
        }
    }
}
