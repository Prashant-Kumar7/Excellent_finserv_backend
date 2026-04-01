import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const now = () => new Date();

async function clearDatabase() {
  await prisma.tenderParticipate.deleteMany();
  await prisma.tenderInterest.deleteMany();
  await prisma.tenderWishlist.deleteMany();
  await prisma.tender.deleteMany();
  await prisma.rFQ.deleteMany();
  await prisma.product.deleteMany();
  await prisma.subCategory.deleteMany();
  await prisma.category.deleteMany();
  await prisma.city.deleteMany();
  await prisma.state.deleteMany();
  await prisma.region.deleteMany();
  await prisma.cibileReportRequest.deleteMany();
  await prisma.insurance.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.perday.deleteMany();
  await prisma.package.deleteMany();
  await prisma.bank.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.coin.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.deposit.deleteMany();
  await prisma.otp.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.user.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.setting.deleteMany();
}

async function main() {
  await clearDatabase();

  const hashedPassword = await bcrypt.hash("Password123!", 10);

  const region = await prisma.region.create({
    data: {
      name: "North",
      created_at: now(),
      updated_at: now(),
    },
  });

  const state = await prisma.state.create({
    data: {
      region_id: region.id,
      name: "Delhi",
      created_at: now(),
      updated_at: now(),
    },
  });

  const city = await prisma.city.create({
    data: {
      state_id: state.id,
      name: "New Delhi",
      created_at: now(),
      updated_at: now(),
    },
  });

  const category = await prisma.category.create({
    data: {
      name: "Steel",
      created_at: now(),
      updated_at: now(),
    },
  });

  const subCategory = await prisma.subCategory.create({
    data: {
      category_id: category.id,
      name: "TMT Bars",
      created_at: now(),
      updated_at: now(),
    },
  });

  const unit = await prisma.unit.create({
    data: {
      name: "MT",
      created_at: now(),
      updated_at: now(),
    },
  });

  const buyer = await prisma.user.create({
    data: {
      regNo: "BUYER001",
      name: "Ravi",
      last_name: "Kumar",
      email: "buyer@example.com",
      mobile: "9000000001",
      password: hashedPassword,
      buyer: 1,
      seller: 0,
      status: 1,
      kyc_status: 1,
      created_at: now(),
      updated_at: now(),
    },
  });

  const seller = await prisma.user.create({
    data: {
      regNo: "SELLER001",
      name: "Anita",
      last_name: "Sharma",
      email: "seller@example.com",
      mobile: "9000000002",
      password: hashedPassword,
      buyer: 0,
      seller: 1,
      status: 1,
      kyc_status: 1,
      bank_name: "HDFC",
      ifsc: "HDFC0001234",
      upi_id: "seller@upi",
      account_number: "1234567890",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.admin.create({
    data: {
      name: "Admin",
      email: "admin@example.com",
      password: hashedPassword,
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.otp.create({
    data: {
      mobile: "9000000003",
      otp: "123456",
      action: "login",
      created_at: now(),
      updated_at: now(),
    },
  });

  const product = await prisma.product.create({
    data: {
      user_id: seller.id,
      category_id: category.id,
      sub_category_id: subCategory.id,
      product_name: "IS 1786 TMT 500D",
      description: "Construction-grade reinforcement steel.",
      stock: 100,
      mrp: new Prisma.Decimal("52000.00"),
      specifications: "Fe500D, 12mm–32mm",
      packaging_details: "Bundles",
      moq: "10 MT",
      payment_terms: "30 days",
      delivery_info: "Pan-India",
      certifications: "BIS",
      images: ["https://example.com/img1.jpg"],
      video: "https://example.com/vid.mp4",
      status: "active",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.rFQ.create({
    data: {
      buyer_id: buyer.id,
      seller_id: seller.id,
      region_id: region.id,
      state_id: state.id,
      city_id: city.id,
      product_id: product.id,
      unit_name: "MT",
      delivery_date: "2026-06-01",
      description: "Need 25 MT for warehouse project.",
      mrp: new Prisma.Decimal("1250000.00"),
      created_at: now(),
      updated_at: now(),
    },
  });

  const tender = await prisma.tender.create({
    data: {
      category_id: category.id,
      sub_category_id: subCategory.id,
      city_id: city.id,
      state_id: state.id,
      region_id: region.id,
      user_id: buyer.id,
      tender_type: "open",
      product_name: "Cement",
      tender_name: "FY26 Infra Cement Supply",
      tender_total: new Prisma.Decimal("5000000.00"),
      tender_start_date: now(),
      tender_end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      tender_description: "Bulk OPC supply.",
      expected_product_rate: new Prisma.Decimal("380.50"),
      product_unit_name: "Bag",
      tender_validity_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      tender_document_type: "pdf",
      tender_document: "https://example.com/tender.pdf",
      tender_quantity: new Prisma.Decimal("10000"),
      tender_status: "open",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.tenderWishlist.create({
    data: {
      user_id: seller.id,
      tender_id: tender.id,
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.tenderInterest.create({
    data: {
      user_id: seller.id,
      tender_id: tender.id,
      message: "We can supply within 14 days.",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.tenderParticipate.create({
    data: {
      user_id: seller.id,
      tender_id: tender.id,
      dispatched_location: "Mumbai",
      paid_emd: new Prisma.Decimal("50000"),
      unit_name: "Bag",
      offer_price: new Prisma.Decimal("375.00"),
      offer_quantity: 5000,
      delivery_period: "21 days",
      company_brochure_document: "https://example.com/brochure.pdf",
      technical_specification_document: "https://example.com/spec.pdf",
      mode_of_transport: "road",
      remarks: "Best rates assured",
      payment_mode: "NEFT",
      order_id: "ORD-SEED-001",
      payment_id: "PAY-SEED-001",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.deposit.create({
    data: {
      regNo: buyer.regNo!,
      amount: new Prisma.Decimal("10000"),
      payment_method: "UPI",
      slip: "https://example.com/slip.jpg",
      status: "pending",
      txn: "TXN-SEED-DEP-001",
      total_amount: new Prisma.Decimal("11800"),
      gst: new Prisma.Decimal("1800"),
      admin_charge: new Prisma.Decimal("200"),
      cf_payment_id: "cf_abc123",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.supportTicket.create({
    data: {
      regNo: buyer.regNo!,
      subject: "KYC pending",
      message: "Documents uploaded twice.",
      status: "open",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.coin.create({
    data: {
      regNo: buyer.regNo!,
      amount: new Prisma.Decimal("50"),
      comment: "Signup bonus",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.wallet.create({
    data: {
      regNo: seller.regNo!,
      amount: new Prisma.Decimal("2500.75"),
      status: "completed",
      comment: "Payout",
      txn_type: "credit",
      tds: new Prisma.Decimal("125.00"),
      service_charge: new Prisma.Decimal("25.00"),
      gst: new Prisma.Decimal("45.00"),
      amount_to_pay: new Prisma.Decimal("2305.75"),
      level: 1,
      source_id: 1,
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.bank.create({
    data: {
      regNo: buyer.regNo!,
      amount: new Prisma.Decimal("7500"),
      status: "success",
      comment: "Withdrawal",
      txn_type: "debit",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.package.create({
    data: {
      regNo: buyer.regNo!,
      amount: new Prisma.Decimal("5000"),
      status: "paid",
      txn: "TXN-PKG-SEED-001",
      slip: "https://example.com/pkg-slip.png",
      payment_method: "card",
      gst: new Prisma.Decimal("900"),
      total_amount: new Prisma.Decimal("5900"),
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.perday.create({
    data: {
      regNo: seller.regNo!,
      amount: new Prisma.Decimal("120"),
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.setting.create({
    data: {
      deposit_limit: new Prisma.Decimal("100000"),
      deposit_admin_charge: new Prisma.Decimal("2"),
      deposit_gst: new Prisma.Decimal("18"),
      income_wallet_withdraw_tds: new Prisma.Decimal("10"),
      income_wallet_withdraw_gst: new Prisma.Decimal("18"),
      service_charge: new Prisma.Decimal("1.5"),
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.loan.create({
    data: {
      regNo: buyer.regNo!,
      name: "Ravi",
      l_name: "Kumar",
      m_name: "",
      mobile: buyer.mobile!,
      pan_number: "ABCDE1234F",
      amount: new Prisma.Decimal("500000"),
      loan_type: "personal",
      fee: new Prisma.Decimal("5000"),
      fee_gst: new Prisma.Decimal("900"),
      total_fee: new Prisma.Decimal("5900"),
      status: "submitted",
      remarks: "Seed application",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.insurance.create({
    data: {
      regNo: seller.regNo!,
      name: "Anita",
      l_name: "Sharma",
      m_name: "",
      mobile: seller.mobile!,
      pan_number: "FGHIJ5678K",
      amount: new Prisma.Decimal("15000"),
      insurance_type: "motor",
      vehicle_number: "DL01AB1234",
      status: "pending",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.cibileReportRequest.create({
    data: {
      regNo: buyer.regNo!,
      application_id: "APP-SEED-001",
      name: "Ravi",
      l_name: "Kumar",
      m_name: "",
      mobile: buyer.mobile!,
      pan_number: "ABCDE1234F",
      amount: new Prisma.Decimal("500"),
      gst: new Prisma.Decimal("90"),
      total_amount: new Prisma.Decimal("590"),
      status: "paid",
      created_at: now(),
      updated_at: now(),
    },
  });

  console.log("Database seeded for all tables.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
