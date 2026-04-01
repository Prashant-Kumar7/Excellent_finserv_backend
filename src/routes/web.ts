import { Router } from "express";
import { notImplementedWeb } from "../controllers/web/notImplementedWeb.js";
import { requireAdminAuth } from "../shared/middleware/adminAuth.js";
import {
  adminDashboard,
  adminLogin,
  adminLoginSubmit,
  adminLogout,
  cibileList,
  depositList,
  incomeWithdrawList,
  insuranceList,
  loanEdit,
  loanList,
  loanUpdate,
  packagePurchaseList,
  updateCibileStatus,
  updateDepositStatus,
  updateIncomeWithdrawStatus,
  updateInsuranceStatus,
  updateLoanStatus,
  updatePackagePurchaseStatus,
  updateWalletWithdrawStatus,
  walletWithdrawList
} from "../controllers/web/adminController.js";
import {
  adminUsersIndex,
  adminUsersShow,
  adminUsersUpdateDetails,
  adminUsersUpdateKycStatus,
  adminUsersUpdateStatus
} from "../controllers/web/adminUserController.js";

export const webRouter = Router();

webRouter.get("/", notImplementedWeb("FrontController.home"));
webRouter.get("/about", notImplementedWeb("FrontController.about"));
webRouter.get("/our_services", notImplementedWeb("FrontController.our_services"));
webRouter.get("/career", notImplementedWeb("FrontController.career"));
webRouter.get("/contact", notImplementedWeb("FrontController.contact"));
webRouter.get("/imwallet/callback", notImplementedWeb("FrontController.imwalletCallback"));
webRouter.post("/contact-submit", notImplementedWeb("FrontController.contactSubmit"));
webRouter.get("/contact-list", notImplementedWeb("FrontController.contactList"));

const adminRouter = Router();
adminRouter.get("/login", adminLogin);
adminRouter.post("/login", adminLoginSubmit);

const adminProtected = Router();
adminProtected.use(requireAdminAuth);
adminProtected.get("/dashboard", adminDashboard);
adminProtected.post("/logout", adminLogout);
adminProtected.get("/", adminDashboard);
adminProtected.get("/users", adminUsersIndex);
adminProtected.get("/users/:user", adminUsersShow);
adminProtected.post("/users/:user/status", adminUsersUpdateStatus);
adminProtected.post("/users/:user/update", adminUsersUpdateDetails);
adminProtected.post("/users/:user/kyc-status", adminUsersUpdateKycStatus);
adminProtected.get("/deposits/:status", depositList);
adminProtected.post("/deposit/status/:id", updateDepositStatus);
adminProtected.get("/package-purchases/:status", packagePurchaseList);
adminProtected.post("/package-purchases/:id/status", updatePackagePurchaseStatus);
adminProtected.post("/income-withdraw-status/:id", updateIncomeWithdrawStatus);
adminProtected.post("/wallet-withdraw-status/:id", updateWalletWithdrawStatus);
adminProtected.get("/income-withdraw-list/:status", incomeWithdrawList);
adminProtected.get("/insurrance/:status", insuranceList);
adminProtected.get("/loan/:status", loanList);
adminProtected.get("/cibile/:status", cibileList);
adminProtected.get("/loan/edit/:id", loanEdit);
adminProtected.post("/loan/update/:id", loanUpdate);
adminProtected.post("/loan-status/:id", updateLoanStatus);
adminProtected.post("/cibile-status/:id", updateCibileStatus);
adminProtected.post("/insurrance-status/:id", updateInsuranceStatus);
adminProtected.get("/wallet-withdraw-list/:status", walletWithdrawList);

adminRouter.use(adminProtected);

webRouter.use("/admin", adminRouter);

