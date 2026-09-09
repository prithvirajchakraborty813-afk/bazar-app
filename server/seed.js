// Optional: run "npm run seed" once to load starter data (Family/Bazar example).
// Safe to skip if you'd rather start empty and add everything from the admin panel.

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function seed() {
  const [family] = await sql`INSERT INTO categories (name) VALUES ('Family') RETURNING id`;
  const [bazar] = await sql`INSERT INTO subcategories (category_id, name) VALUES (${family.id}, 'Bazar') RETURNING id`;
  await sql`INSERT INTO items (subcategory_id, name, price, description) VALUES
    (${bazar.id}, 'Chal', '60', 'Rice, 1kg pack'),
    (${bazar.id}, 'Dal', '110', 'Masoor dal, 1kg'),
    (${bazar.id}, 'Alu', '25', 'Potato, per kg')`;

  const [bathroom] = await sql`INSERT INTO categories (name) VALUES ('Bathroom') RETURNING id`;
  const [electric] = await sql`INSERT INTO subcategories (category_id, name) VALUES (${bathroom.id}, 'Electric Repair') RETURNING id`;
  await sql`INSERT INTO items (subcategory_id, name, price, description) VALUES
    (${electric.id}, 'Geyser fix', '300', 'Call-out visit')`;

  console.log("Seed data inserted.");
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
