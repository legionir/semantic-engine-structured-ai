module Store
  class OrderProcessor
    def initialize(gateway)
      @gateway = gateway
    end

    def process(order)
      raise "Invalid order" unless order.valid?
      
      tx = @gateway.charge(order.total)
      order.mark_as_paid(tx)
    end
  end
end
