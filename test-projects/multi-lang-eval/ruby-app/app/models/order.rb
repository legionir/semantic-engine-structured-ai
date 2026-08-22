module Store
  class Order
    attr_reader :id, :total, :status

    def initialize(id, total)
      @id = id
      @total = total
      @status = 'pending'
    end

    def valid?
      @total > 0
    end

    def mark_as_paid(transaction_id)
      @status = 'paid'
      @transaction_id = transaction_id
    end
  end
end
