import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  Announcement,
  DepositPolicy,
  GuestStartPayment,
  GuestStartPaymentSchema,
  PaymentIntentResponse,
  ShopContact,
  WaitlistRequest,
  WaitlistRequestSchema,
  DynamicEntityTypeSchema,
  Page,
  SchemaList,
  SearchProducts,
  SearchProductsSchema,
  StorefrontPublicResponse,
} from '@marketplace/contracts';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { EventResponse, EventsService } from '../events/events.service';
import { ProductResponse, ProductsService } from '../products/products.service';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { PaymentsService } from '../payments/payments.service';
import { GuestGuard } from '../guest/guest.guard';
import { UseGuards } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { StorefrontService } from '../storefront/storefront.service';
import { ShopScope } from './shop-scope';

/**
 * What a stranger may read about a shop. Every route is `@Public()` and every
 * handler is one `ShopScope.run` around a service call the cockpit already
 * uses -- the visibility rules live in the services, not here.
 */
@Controller('shops/:tenantId')
export class ShopsController {
  constructor(
    private readonly scope: ShopScope,
    private readonly products: ProductsService,
    private readonly events: EventsService,
    private readonly storefront: StorefrontService,
    private readonly settings: SettingsService,
    private readonly registry: SchemaRegistryService,
    private readonly payments: PaymentsService,
  ) {}

  /** Enveloped for the same reason `GET /storefront` is: a bare null is an empty body. */
  @Get('storefront')
  @Public()
  getStorefront(@Param('tenantId') tenantId: string): Promise<StorefrontPublicResponse> {
    return this.scope.run(tenantId, async () => ({ config: await this.storefront.getPublished() }));
  }

  @Get('announcement')
  @Public()
  getAnnouncement(@Param('tenantId') tenantId: string): Promise<Announcement> {
    return this.scope.run(tenantId, () => this.settings.getAnnouncement());
  }

  /** The footer prints these on every page of the shop, so a stranger may read them. */
  @Get('contact')
  @Public()
  getContact(@Param('tenantId') tenantId: string): Promise<ShopContact> {
    return this.scope.run(tenantId, () => this.settings.getContact());
  }

  /**
   * Somebody asking to hear when a sold-out piece comes back. Public and
   * throttled: it takes an address, and it must not become a way to find out
   * which addresses are already waiting.
   */
  @Post('products/:id/waitlist')
  @Public()
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async joinWaitlist(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @ZodBody(WaitlistRequestSchema) body: WaitlistRequest,
  ): Promise<{ waiting: true }> {
    await this.scope.run(tenantId, () => this.products.joinWaitlist(id, body.email));
    return { waiting: true };
  }

  /**
   * What the shopper's waiting page asks while a UPI payment is in flight, and
   * what the reconciliation poll asks when a webhook never arrives.
   *
   * Public, and on the shop surface because the tenant has to come from the
   * address: every read in this engine is scoped to a partition. The intent id
   * is an unguessable token the shopper was handed; it names no order and no
   * customer, and the answer is a state and an amount.
   */
  @Get('payments/:intentId')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  paymentStatus(
    @Param('tenantId') tenantId: string,
    @Param('intentId') intentId: string,
  ): Promise<PaymentIntentResponse> {
    return this.scope.run(tenantId, () => this.payments.status(intentId));
  }

  /**
   * Starting a UPI payment as a stranger, on the ticket they checked out with
   * or the email they can prove the order by.
   */
  @Post('orders/:id/payments')
  @Public()
  @UseGuards(GuestGuard)
  @HttpCode(200)
  startGuestPayment(
    @Param('id') id: string,
    @ZodBody(GuestStartPaymentSchema) body: GuestStartPayment,
  ): Promise<PaymentIntentResponse> {
    const { email, ...input } = body;
    return this.payments.start(id, input, { guestEmail: email });
  }

  /** The cart has to know whether this shop offers a deposit before it can offer one. */
  @Get('deposit')
  @Public()
  getDepositPolicy(@Param('tenantId') tenantId: string): Promise<DepositPolicy> {
    return this.scope.run(tenantId, () => this.settings.getDepositPolicy());
  }

  /** The filter rail renders the tenant's own fields; they are part of the shop window. */
  @Get('schemas')
  @Public()
  listSchemas(@Param('tenantId') tenantId: string): Promise<SchemaList> {
    return this.scope.run(tenantId, async () => ({
      items: await Promise.all(
        DynamicEntityTypeSchema.options.map(async (entityType) => {
          const { version, fields } = await this.registry.get(entityType);
          return { entityType, version, fields };
        }),
      ),
    }));
  }

  @Get('products')
  @Public()
  listProducts(
    @Param('tenantId') tenantId: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<ProductResponse>> {
    return this.scope.run(tenantId, () =>
      this.products.listVisible(query.limit, query.cursor ?? null),
    );
  }

  // Declared before ':id' for the same reason as the token route: Nest would
  // otherwise read 'search' as a product id.
  @Post('products/search')
  @Public()
  @HttpCode(200)
  searchProducts(
    @Param('tenantId') tenantId: string,
    @ZodBody(SearchProductsSchema) body: SearchProducts,
  ): Promise<Page<ProductResponse>> {
    return this.scope.run(tenantId, () => this.products.searchVisible(body));
  }

  @Get('products/:id')
  @Public()
  getProduct(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<ProductResponse> {
    return this.scope.run(tenantId, () => this.products.getVisible(id));
  }

  @Get('events')
  @Public()
  listEvents(
    @Param('tenantId') tenantId: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<EventResponse>> {
    return this.scope.run(tenantId, () => this.events.list(query.limit, query.cursor ?? null));
  }

  @Get('events/:id')
  @Public()
  getEvent(@Param('tenantId') tenantId: string, @Param('id') id: string): Promise<EventResponse> {
    return this.scope.run(tenantId, () => this.events.get(id));
  }
}
