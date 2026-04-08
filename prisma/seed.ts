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

  const userSeeds: Array<{
    id?: number;
    regNo: string;
    name: string;
    last_name: string;
    email: string;
    mobile: string;
    buyer: number;
    seller: number;
    bank_name?: string;
    ifsc?: string;
    upi_id?: string;
    account_number?: string;
  }> = [
    // AppConfig.defaultSponsorMobile expects a sponsor to exist.
    {
      id: 1,
      regNo: "EX000001",
      name: "Default",
      last_name: "Sponsor",
      email: "sponsor@example.com",
      mobile: "0123456789",
      buyer: 1,
      seller: 1,
      bank_name: "SBI",
      ifsc: "SBIN0000999",
      upi_id: "sponsor@upi",
      account_number: "111122223333",
    },
    {
      id: 2,
      regNo: "EX000002",
      name: "Ravi",
      last_name: "Kumar",
      email: "ravi.k@example.com",
      mobile: "9000000001",
      buyer: 1,
      seller: 0,
    },
    {
      id: 3,
      regNo: "EX000003",
      name: "Anita",
      last_name: "Sharma",
      email: "anita.s@example.com",
      mobile: "9000000002",
      buyer: 0,
      seller: 1,
      bank_name: "HDFC",
      ifsc: "HDFC0001234",
      upi_id: "anita@upi",
      account_number: "1234567890",
    },
    {
      id: 4,
      regNo: "EX000004",
      name: "Vikram",
      last_name: "Singh",
      email: "vikram.s@example.com",
      mobile: "9000000003",
      buyer: 1,
      seller: 0,
    },
    {
      id: 5,
      regNo: "EX000005",
      name: "Priya",
      last_name: "Nair",
      email: "priya.n@example.com",
      mobile: "9000000004",
      buyer: 0,
      seller: 1,
      bank_name: "ICICI",
      ifsc: "ICIC0004321",
      upi_id: "priya@upi",
      account_number: "9876543210",
    },
    {
      id: 6,
      regNo: "EX000006",
      name: "Arjun",
      last_name: "Mehta",
      email: "arjun.m@example.com",
      mobile: "9000000005",
      buyer: 1,
      seller: 1,
      bank_name: "SBI",
      ifsc: "SBIN0000999",
      upi_id: "arjun@upi",
      account_number: "5555666677",
    },
  ];

  const users = await Promise.all(
    userSeeds.map((u) => {
      const hasBank = u.bank_name !== undefined;
      return prisma.user.create({
        data: {
          ...(u.id !== undefined ? { id: u.id } : {}),
          regNo: u.regNo,
          name: u.name,
          last_name: u.last_name,
          email: u.email,
          mobile: u.mobile,
          password: hashedPassword,
          buyer: u.buyer,
          seller: u.seller,
          status: 1,
          kyc_status: 1,
          ...(hasBank && u.ifsc !== undefined && u.upi_id !== undefined && u.account_number !== undefined
            ? {
                bank_name: u.bank_name,
                ifsc: u.ifsc,
                upi_id: u.upi_id,
                account_number: u.account_number,
              }
            : {}),
          created_at: now(),
          updated_at: now(),
        },
      });
    })
  );

  // Keep the existing logic naming, but we now have a sponsor user at index 0.
  const [_sponsor, buyer1, seller1, buyer2, seller2, both] = users;

  await prisma.admin.create({
    data: {
      name: "Admin",
      email: "admin@example.com",
      password: hashedPassword,
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.otp.createMany({
    data: [
      { mobile: "9000000001", otp: "111111", action: "login", created_at: now(), updated_at: now() },
      { mobile: "9000000002", otp: "222222", action: "login", created_at: now(), updated_at: now() },
      { mobile: "9000000003", otp: "333333", action: "verify", created_at: now(), updated_at: now() },
      { mobile: "9000000004", otp: "444444", action: "login", created_at: now(), updated_at: now() },
      { mobile: "9000000005", otp: "555555", action: "reset", created_at: now(), updated_at: now() },
    ],
  });

  const product1 = await prisma.product.create({
    data: {
      user_id: seller1.id,
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

  const product2 = await prisma.product.create({
    data: {
      user_id: seller2.id,
      category_id: category.id,
      sub_category_id: subCategory.id,
      product_name: "OPC 53 Grade Cement",
      description: "Bulk cement for infra projects.",
      stock: 500,
      mrp: new Prisma.Decimal("310.00"),
      specifications: "50 kg bags",
      packaging_details: "Truck load",
      moq: "100 bags",
      payment_terms: "15 days",
      delivery_info: "North India",
      certifications: "ISO",
      images: ["https://example.com/cement.jpg"],
      status: "active",
      created_at: now(),
      updated_at: now(),
    },
  });

  const product3 = await prisma.product.create({
    data: {
      user_id: both.id,
      category_id: category.id,
      sub_category_id: subCategory.id,
      product_name: "Copper wiring 4 sq.mm",
      description: "House and industrial cabling.",
      stock: 200,
      mrp: new Prisma.Decimal("4500.00"),
      specifications: "FR-LSH",
      packaging_details: "100m rolls",
      moq: "20 rolls",
      payment_terms: "immediate",
      delivery_info: "Metro cities",
      certifications: "ISI",
      images: ["https://example.com/wire.jpg"],
      status: "active",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.rFQ.createMany({
    data: [
      {
        buyer_id: buyer1.id,
        seller_id: seller1.id,
        region_id: region.id,
        state_id: state.id,
        city_id: city.id,
        product_id: product1.id,
        unit_name: "MT",
        delivery_date: "2026-06-01",
        description: "Need 25 MT for warehouse project.",
        mrp: new Prisma.Decimal("1250000.00"),
        created_at: now(),
        updated_at: now(),
      },
      {
        buyer_id: buyer2.id,
        seller_id: seller2.id,
        region_id: region.id,
        state_id: state.id,
        city_id: city.id,
        product_id: product2.id,
        unit_name: "bags",
        delivery_date: "2026-07-15",
        description: "Urgent 800 bags for site.",
        mrp: new Prisma.Decimal("248000.00"),
        created_at: now(),
        updated_at: now(),
      },
      {
        buyer_id: buyer1.id,
        seller_id: both.id,
        region_id: region.id,
        state_id: state.id,
        city_id: city.id,
        product_id: product3.id,
        unit_name: "rolls",
        delivery_date: "2026-05-20",
        description: "Office fit-out wiring.",
        mrp: new Prisma.Decimal("90000.00"),
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  const tender1 = await prisma.tender.create({
    data: {
      category_id: category.id,
      sub_category_id: subCategory.id,
      city_id: city.id,
      state_id: state.id,
      region_id: region.id,
      user_id: buyer2.id,
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

  const tender2 = await prisma.tender.create({
    data: {
      category_id: category.id,
      sub_category_id: subCategory.id,
      city_id: city.id,
      state_id: state.id,
      region_id: region.id,
      user_id: buyer1.id,
      tender_type: "limited",
      product_name: "Steel structurals",
      tender_name: "Bridge girders procurement",
      tender_total: new Prisma.Decimal("12000000.00"),
      tender_start_date: now(),
      tender_end_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      tender_description: "Custom sections for NCR belt.",
      expected_product_rate: new Prisma.Decimal("62000"),
      product_unit_name: "MT",
      tender_validity_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      tender_document_type: "pdf",
      tender_document: "https://example.com/tender-steel.pdf",
      tender_quantity: new Prisma.Decimal("200"),
      tender_status: "open",
      created_at: now(),
      updated_at: now(),
    },
  });

  await prisma.tenderWishlist.createMany({
    data: [
      { user_id: seller1.id, tender_id: tender1.id, created_at: now(), updated_at: now() },
      { user_id: seller2.id, tender_id: tender1.id, created_at: now(), updated_at: now() },
      { user_id: both.id, tender_id: tender1.id, created_at: now(), updated_at: now() },
      { user_id: seller1.id, tender_id: tender2.id, created_at: now(), updated_at: now() },
    ],
  });

  await prisma.tenderInterest.createMany({
    data: [
      {
        user_id: seller1.id,
        tender_id: tender1.id,
        message: "We can supply within 14 days.",
        created_at: now(),
        updated_at: now(),
      },
      {
        user_id: seller2.id,
        tender_id: tender1.id,
        message: "Stock available at Jaipur hub.",
        created_at: now(),
        updated_at: now(),
      },
      {
        user_id: both.id,
        tender_id: tender2.id,
        message: "Feasible in two phases.",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.tenderParticipate.createMany({
    data: [
      {
        user_id: seller1.id,
        tender_id: tender1.id,
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
      {
        user_id: seller2.id,
        tender_id: tender1.id,
        dispatched_location: "Jaipur",
        paid_emd: new Prisma.Decimal("50000"),
        unit_name: "Bag",
        offer_price: new Prisma.Decimal("372.50"),
        offer_quantity: 5000,
        delivery_period: "18 days",
        company_brochure_document: "https://example.com/brochure2.pdf",
        technical_specification_document: "https://example.com/spec2.pdf",
        mode_of_transport: "rail",
        remarks: "JIT schedule possible",
        payment_mode: "RTGS",
        order_id: "ORD-SEED-002",
        payment_id: "PAY-SEED-002",
        created_at: now(),
        updated_at: now(),
      },
      {
        user_id: both.id,
        tender_id: tender2.id,
        dispatched_location: "Delhi NCR",
        paid_emd: new Prisma.Decimal("200000"),
        unit_name: "MT",
        offer_price: new Prisma.Decimal("61500"),
        offer_quantity: 80,
        delivery_period: "60 days",
        company_brochure_document: "https://example.com/brochure3.pdf",
        technical_specification_document: "https://example.com/spec3.pdf",
        mode_of_transport: "road",
        remarks: "Phased milling OK",
        payment_mode: "LC",
        order_id: "ORD-SEED-003",
        payment_id: "PAY-SEED-003",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.deposit.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        amount: new Prisma.Decimal("10000"),
        payment_method: "UPI",
        slip: "https://example.com/slip1.jpg",
        status: "pending",
        txn: "TXN-SEED-DEP-001",
        total_amount: new Prisma.Decimal("11800"),
        gst: new Prisma.Decimal("1800"),
        admin_charge: new Prisma.Decimal("200"),
        cf_payment_id: "cf_abc123",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: buyer2.regNo!,
        amount: new Prisma.Decimal("25000"),
        payment_method: "NEFT",
        slip: "https://example.com/slip2.jpg",
        status: "completed",
        txn: "TXN-SEED-DEP-002",
        total_amount: new Prisma.Decimal("29500"),
        gst: new Prisma.Decimal("4500"),
        admin_charge: new Prisma.Decimal("500"),
        cf_payment_id: "cf_def456",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: both.regNo!,
        amount: new Prisma.Decimal("5000"),
        payment_method: "card",
        slip: "https://example.com/slip3.jpg",
        status: "pending",
        txn: "TXN-SEED-DEP-003",
        total_amount: new Prisma.Decimal("5900"),
        gst: new Prisma.Decimal("900"),
        admin_charge: new Prisma.Decimal("100"),
        cf_payment_id: "cf_ghi789",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.supportTicket.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        subject: "KYC pending",
        message: "Documents uploaded twice.",
        status: "open",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: buyer2.regNo!,
        subject: "Invoice mismatch",
        message: "GST number wrong on last receipt.",
        status: "open",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: both.regNo!,
        subject: "Wallet credit delay",
        message: "Payout still not reflected.",
        status: "in_progress",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.coin.createMany({
    data: [
      { regNo: buyer1.regNo!, amount: new Prisma.Decimal("50"), comment: "Signup bonus", created_at: now(), updated_at: now() },
      { regNo: buyer2.regNo!, amount: new Prisma.Decimal("30"), comment: "Referral", created_at: now(), updated_at: now() },
    ],
  });

  await prisma.wallet.createMany({
    data: [
      {
        regNo: seller1.regNo!,
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
      {
        regNo: seller2.regNo!,
        amount: new Prisma.Decimal("880.20"),
        status: "completed",
        comment: "Commission",
        txn_type: "credit",
        tds: new Prisma.Decimal("44.00"),
        service_charge: new Prisma.Decimal("10.00"),
        gst: new Prisma.Decimal("18.00"),
        amount_to_pay: new Prisma.Decimal("808.20"),
        level: 2,
        source_id: 2,
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: both.regNo!,
        amount: new Prisma.Decimal("1200"),
        status: "pending",
        comment: "Mixed order settlement",
        txn_type: "credit",
        tds: new Prisma.Decimal("60"),
        service_charge: new Prisma.Decimal("15"),
        gst: new Prisma.Decimal("27"),
        amount_to_pay: new Prisma.Decimal("1098"),
        level: 1,
        source_id: 3,
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.bank.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        amount: new Prisma.Decimal("7500"),
        status: "success",
        comment: "Withdrawal",
        txn_type: "debit",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: buyer2.regNo!,
        amount: new Prisma.Decimal("12000"),
        status: "success",
        comment: "Withdrawal",
        txn_type: "debit",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.package.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        amount: new Prisma.Decimal("5000"),
        status: "paid",
        txn: "TXN-PKG-SEED-001",
        slip: "https://example.com/pkg-slip1.png",
        payment_method: "card",
        gst: new Prisma.Decimal("900"),
        total_amount: new Prisma.Decimal("5900"),
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: buyer2.regNo!,
        amount: new Prisma.Decimal("10000"),
        status: "paid",
        txn: "TXN-PKG-SEED-002",
        slip: "https://example.com/pkg-slip2.png",
        payment_method: "UPI",
        gst: new Prisma.Decimal("1800"),
        total_amount: new Prisma.Decimal("11800"),
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.perday.createMany({
    data: [
      { regNo: seller1.regNo!, amount: new Prisma.Decimal("120"), created_at: now(), updated_at: now() },
      { regNo: seller2.regNo!, amount: new Prisma.Decimal("95"), created_at: now(), updated_at: now() },
      { regNo: both.regNo!, amount: new Prisma.Decimal("200"), created_at: now(), updated_at: now() },
    ],
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

  await prisma.loan.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        name: buyer1.name!,
        l_name: buyer1.last_name!,
        m_name: "",
        mobile: buyer1.mobile!,
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
      {
        regNo: buyer2.regNo!,
        name: buyer2.name!,
        l_name: buyer2.last_name!,
        m_name: "",
        mobile: buyer2.mobile!,
        pan_number: "LMNOP9012Q",
        amount: new Prisma.Decimal("2500000"),
        loan_type: "business",
        fee: new Prisma.Decimal("15000"),
        fee_gst: new Prisma.Decimal("2700"),
        total_fee: new Prisma.Decimal("17700"),
        status: "under_review",
        remarks: "Working capital",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.insurance.createMany({
    data: [
      {
        regNo: seller1.regNo!,
        name: seller1.name!,
        l_name: seller1.last_name!,
        m_name: "",
        mobile: seller1.mobile!,
        pan_number: "FGHIJ5678K",
        amount: new Prisma.Decimal("15000"),
        insurance_type: "motor",
        vehicle_number: "DL01AB1234",
        status: "pending",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: seller2.regNo!,
        name: seller2.name!,
        l_name: seller2.last_name!,
        m_name: "",
        mobile: seller2.mobile!,
        pan_number: "RSTUV3456W",
        amount: new Prisma.Decimal("8500"),
        insurance_type: "health",
        vehicle_number: null,
        status: "approved",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  await prisma.cibileReportRequest.createMany({
    data: [
      {
        regNo: buyer1.regNo!,
        application_id: "APP-SEED-001",
        name: buyer1.name!,
        l_name: buyer1.last_name!,
        m_name: "",
        mobile: buyer1.mobile!,
        pan_number: "ABCDE1234F",
        amount: new Prisma.Decimal("500"),
        gst: new Prisma.Decimal("90"),
        total_amount: new Prisma.Decimal("590"),
        status: "paid",
        created_at: now(),
        updated_at: now(),
      },
      {
        regNo: buyer2.regNo!,
        application_id: "APP-SEED-002",
        name: buyer2.name!,
        l_name: buyer2.last_name!,
        m_name: "",
        mobile: buyer2.mobile!,
        pan_number: "LMNOP9012Q",
        amount: new Prisma.Decimal("500"),
        gst: new Prisma.Decimal("90"),
        total_amount: new Prisma.Decimal("590"),
        status: "pending",
        created_at: now(),
        updated_at: now(),
      },
    ],
  });

  console.log(`Seeded ${users.length} users and related rows.`);
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
