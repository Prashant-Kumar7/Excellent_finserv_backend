import { Router } from "express";
import { requireGlobalApiKey } from "../shared/middleware/globalApiKey.js";
import { requireUserAuth } from "../shared/middleware/userAuth.js";
import { vkycRouter } from "./vkycRoutes.js";
import {
  checkSponsor,
  login,
  loginWithOtp,
  mobileLogin,
  registerWithOtp,
  resetPasswordWithOtp,
  sendForgetOtp
} from "../controllers/api/userAuthController.js";
import {
  bankWalletWithdraw,
  bankHistory,
  bankWalletWithdrawCancel,
  bankReversePennyDropStatus,
  cashfreeWebhook,
  createBankReversePennyDrop,
  createCashfreeSession,
  createKycDigilockerUrl,
  cibilHistory,
  cibilSubmit,
  coinWalletWithdraw,
  coinHistory,
  createTicket,
  dashboard,
  deleteAccount,
  deposit,
  deposit2,
  depositHistory,
  digitalDeclarationAccept,
  digilockerDocument,
  digilockerStatus,
  incomeWalletWithdraw,
  incomeWalletWithdrawCancel,
  holdEarnSubmit,
  holdEarnLock,
  holdEarnWithdraw,
  holdEarnActive,
  insuranceHistory,
  insuranceRequest,
  loanHistory,
  loanRequest,
  mobileRechargeRequest,
  myDirects,
  myTickets,
  purchasePackage,
  purchasePackageHistory,
  secureIdWebhook,
  updatePassword,
  updateProfile,
  uploadProfileAvatar,
  walletHistory
} from "../controllers/api/homeController.js";
import {
  createProduct,
  deleteProduct,
  listProducts,
  showProduct,
  updateProduct
} from "../controllers/api/productController.js";
import { addRFQ, deleteRFQ, getSingleRFQ, listRFQs } from "../controllers/api/rfqController.js";
import {
  saveTender,
  singleTender,
  tenderCreateForm,
  tenderGetCityByState,
  tenderGetSubcategoryFromCategory,
  tenderList
} from "../controllers/api/tenderController.js";
import {
  interestIndex,
  interestSubmit
} from "../controllers/api/tenderInterestController.js";
import {
  participateList,
  participateSingle,
  participateStore
} from "../controllers/api/tenderParticipateController.js";
import {
  wishlistAdd,
  wishlistIndex,
  wishlistRemove
} from "../controllers/api/tenderWishlistController.js";

export const apiRouter = Router();

// Cashfree webhook (no API key middleware in Laravel)
apiRouter.post("/cashfree/webhook", cashfreeWebhook);
apiRouter.post("/cashfree/secureid/webhook", secureIdWebhook);

// Cashfree VKYC APIs
apiRouter.use("/vkyc", vkycRouter);

// All /user routes are behind globalapikey in Laravel
const userRouter = Router();

userRouter.post("/login", login);
userRouter.post("/check-mobile", checkSponsor);
userRouter.post("/chk-mobile-otp", registerWithOtp);
userRouter.post("/mobile-login", mobileLogin);
userRouter.post("/mobile-login-otp-verify", loginWithOtp);
userRouter.post("/forget/send-otp", sendForgetOtp);
userRouter.post("/forget/reset-password", resetPasswordWithOtp);

const protectedUserRouter = Router();
protectedUserRouter.use(requireUserAuth);
protectedUserRouter.post("/tender_create_form", tenderCreateForm);
protectedUserRouter.post("/tender_get_city", tenderGetCityByState);
protectedUserRouter.post(
  "/tender_get_subcategroy_from_categroy",
  tenderGetSubcategoryFromCategory
);
protectedUserRouter.post("/tender_store", saveTender);
protectedUserRouter.get("/single_tende/:tender_id", singleTender);
protectedUserRouter.post("/tender_list", tenderList);
protectedUserRouter.post("/dashboard", dashboard);
protectedUserRouter.post("/mobile-recharge-request", mobileRechargeRequest);
protectedUserRouter.post("/digital-declaration-accept", digitalDeclarationAccept);
protectedUserRouter.post("/declaration/accept", digitalDeclarationAccept);
protectedUserRouter.post("/hold-earn-submit", holdEarnSubmit);
protectedUserRouter.post("/hold-earn-lock", holdEarnLock);
protectedUserRouter.post("/hold-earn-withdraw", holdEarnWithdraw);
protectedUserRouter.get("/hold-earn-active", holdEarnActive);
protectedUserRouter.get("/wallet-history", walletHistory);
protectedUserRouter.get("/coins-history", coinHistory);
protectedUserRouter.get("/wallet-history/:comment", walletHistory);
protectedUserRouter.get("/my-directs", myDirects);
protectedUserRouter.post("/support/create", createTicket);
protectedUserRouter.get("/cibile-history", cibilHistory);
protectedUserRouter.post("/cibile-request", cibilSubmit);
protectedUserRouter.get("/loan-history", loanHistory);
protectedUserRouter.post("/loan-request", loanRequest);
protectedUserRouter.get("/insurance-history", insuranceHistory);
protectedUserRouter.post("/insurance-request", insuranceRequest);
protectedUserRouter.get("/support/my", myTickets);
protectedUserRouter.get("/deposit-history", depositHistory);
protectedUserRouter.post("/deposit", deposit);
protectedUserRouter.post("/deposit2", deposit2);
protectedUserRouter.post("/cashfree/create-session", createCashfreeSession);
protectedUserRouter.get("/bank-history", bankHistory);
protectedUserRouter.post("/purchase_package", purchasePackage);
protectedUserRouter.get("/purchase_package_history", purchasePackageHistory);
protectedUserRouter.post("/bank_wallet_withdraw", bankWalletWithdraw);
protectedUserRouter.post("/income_wallet_withdraw", incomeWalletWithdraw);
protectedUserRouter.post("/coin_wallet_withdraw", coinWalletWithdraw);
protectedUserRouter.get("/bank_wallet_withdraw_cancel", bankWalletWithdrawCancel);
protectedUserRouter.get("/income_wallet_withdraw_cancel", incomeWalletWithdrawCancel);
protectedUserRouter.post("/profile/update", updateProfile);
protectedUserRouter.post("/kyc/digilocker/create-url", createKycDigilockerUrl);
protectedUserRouter.get("/kyc/digilocker/status", digilockerStatus);
protectedUserRouter.get("/kyc/digilocker/document/:documentType", digilockerDocument);
protectedUserRouter.post("/kyc/bank/reverse-penny-drop/create", createBankReversePennyDrop);
protectedUserRouter.get("/kyc/bank/reverse-penny-drop/status", bankReversePennyDropStatus);
protectedUserRouter.post("/profile/avatar", uploadProfileAvatar);
protectedUserRouter.post("/update-password", updatePassword);
protectedUserRouter.post("/account/delete", deleteAccount);
protectedUserRouter.post("/wishlist/add", wishlistAdd);
protectedUserRouter.post("/wishlist/remove", wishlistRemove);
protectedUserRouter.get("/wishlist", wishlistIndex);
protectedUserRouter.post("/interest/submit", interestSubmit);
protectedUserRouter.get("/interest/list", interestIndex);
protectedUserRouter.get(
  "/single_tende_participate/:myid",
  participateSingle
);
protectedUserRouter.get("/participate_history", participateList);
protectedUserRouter.post("/save_participation", participateStore);
protectedUserRouter.get("/products/:user_type", listProducts);
protectedUserRouter.get("/products/:id/:user_type", showProduct);
protectedUserRouter.post("/products", createProduct);
protectedUserRouter.post("/products/:id/:user_type", updateProduct);
protectedUserRouter.put("/products/:id", updateProduct);
protectedUserRouter.delete("/products/:id", deleteProduct);
protectedUserRouter.post("/add_rfq", addRFQ);
protectedUserRouter.get("/rfq_single/:id", getSingleRFQ);
protectedUserRouter.get("/rfq_listing", listRFQs);
protectedUserRouter.delete("/rfq_delete/:id", deleteRFQ);

userRouter.use(protectedUserRouter);

// Attach nested router with middleware
apiRouter.use("/user", requireGlobalApiKey, userRouter);

